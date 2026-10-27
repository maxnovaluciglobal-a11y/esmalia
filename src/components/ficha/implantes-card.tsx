/**
 * MKT-09 · Implantes del paciente en la ficha (Ola 9): pieza, marca y
 * modelo, medidas, lote, fecha, profesional, estado y controles. Registrar
 * un implante o un control lo puede todo rol clínico con escritura; la base
 * valida el profesional, guarda su nombre y pasa el estado del control al
 * implante. La búsqueda por lote (retiro del fabricante) está en /implantes.
 */
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import { Label } from "@/components/ui/label";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  ESTADOS_IMPLANTE,
  ETIQUETA_ESTADO_IMPLANTE,
  controlImplanteSchema,
  estaEnBoca,
  formatearMedidas,
  implanteSchema,
  leerMedida,
  type EstadoImplante,
  type Implante,
} from "@/lib/clinical/implantes";
import {
  guardarImplante,
  listImplantesDelPaciente,
  registrarControlImplante,
} from "@/lib/clinical/implantes.functions";
import { listProfesionalesClinicos } from "@/lib/clinical/prescriptions.functions";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const TONO_ESTADO: Record<EstadoImplante, string> = {
  colocado: "border-control text-foreground/80",
  oseointegrado: "border-success-border bg-success-soft text-success",
  cargado: "border-foreground bg-foreground text-background",
  en_observacion: "border-warning-border bg-warning-soft text-warning",
  fallido: "border-destructive-border bg-destructive-soft text-destructive",
  retirado: "border-control text-muted-foreground",
};

export function ChipEstadoImplante({ estado }: { estado: EstadoImplante }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center rounded-full border px-2.5 text-[12.5px] font-semibold whitespace-nowrap",
        TONO_ESTADO[estado],
      )}
    >
      {ETIQUETA_ESTADO_IMPLANTE[estado]}
    </span>
  );
}

export function ImplantesCard({
  clinicId,
  patientId,
  puedeEditar,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  timezone: string;
}) {
  const listar = useServerFn(listImplantesDelPaciente);
  const consulta = useQuery({
    queryKey: ["implantes", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
  });
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const implantes = consulta.data ?? [];
  const enBoca = implantes.filter((i) => estaEnBoca(i.status)).length;

  return (
    <section
      aria-labelledby="implantes-titulo"
      className="rounded-panel border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="implantes-titulo"
            className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
          >
            Implantes
            {implantes.length > 0 && (
              <>
                {" "}
                <em className="text-brand-600">
                  · <span className="cifra not-italic">{enBoca}</span> en boca
                </em>
              </>
            )}
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Marca, modelo, medidas y lote de cada implante, con sus controles.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/implantes"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
          >
            <Search className="size-4" aria-hidden /> Buscar por lote
          </Link>
          {puedeEditar && !nuevo && (
            <button
              type="button"
              onClick={() => setNuevo(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background pointer-coarse:h-11"
            >
              <Plus className="size-4" aria-hidden /> Registrar implante
            </button>
          )}
        </div>
      </div>

      {nuevo && (
        <FormularioImplante
          clinicId={clinicId}
          patientId={patientId}
          timezone={timezone}
          implante={null}
          onCerrar={() => setNuevo(false)}
        />
      )}

      <div className="mt-4">
        {consulta.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando implantes…
          </p>
        ) : consulta.isError ? (
          <p className="text-sm text-muted-foreground">{mensajeDeError(consulta.error)}</p>
        ) : implantes.length === 0 ? (
          <p className="text-base text-muted-foreground">
            Este paciente no tiene implantes registrados.
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-[14px] border border-hairline">
            {implantes.map((i) =>
              editando === i.id ? (
                <li key={i.id} className="p-3">
                  <FormularioImplante
                    clinicId={clinicId}
                    patientId={patientId}
                    timezone={timezone}
                    implante={i}
                    onCerrar={() => setEditando(null)}
                  />
                </li>
              ) : (
                <FilaImplante
                  key={i.id}
                  clinicId={clinicId}
                  patientId={patientId}
                  implante={i}
                  timezone={timezone}
                  puedeEditar={puedeEditar}
                  onEditar={() => setEditando(i.id)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function FilaImplante({
  clinicId,
  patientId,
  implante: i,
  timezone,
  puedeEditar,
  onEditar,
}: {
  clinicId: string;
  patientId: string;
  implante: Implante;
  timezone: string;
  puedeEditar: boolean;
  onEditar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const medidas = formatearMedidas(i.diameterMm, i.lengthMm);
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="cifra grid size-11 shrink-0 place-items-center rounded-full border border-foreground text-base font-semibold"
            aria-label={`Pieza ${i.tooth}`}
          >
            {i.tooth}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold">
              {i.brand}
              {i.model ? ` ${i.model}` : ""}
              {medidas && <span className="font-normal text-muted-foreground"> · {medidas}</span>}
            </p>
            <p className="text-sm text-muted-foreground">
              Lote <span className="cifra text-foreground">{i.lot}</span>
              {i.reference ? (
                <>
                  {" "}
                  · Ref. <span className="cifra">{i.reference}</span>
                </>
              ) : null}{" "}
              · {fecha(i.placedOn, timezone)}
              {i.professionalName ? ` · ${i.professionalName}` : ""}
              {i.removedOn ? ` · retirado el ${fecha(i.removedOn, timezone)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ChipEstadoImplante estado={i.status} />
          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            aria-expanded={abierto}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-control px-3 text-[13px] font-semibold hover:border-foreground pointer-coarse:h-11"
          >
            {i.controles.length === 1 ? "1 control" : `${i.controles.length} controles`}
            <ChevronDown
              className={cn("size-3.5 transition-transform", abierto && "rotate-180")}
              aria-hidden
            />
          </button>
        </div>
      </div>
      {abierto && (
        <div className="mt-3 space-y-3 pl-0 sm:pl-14">
          {i.notes && <p className="text-sm text-muted-foreground">{i.notes}</p>}
          {i.controles.length > 0 ? (
            <ol className="space-y-2 border-l border-hairline pl-3">
              {i.controles.map((c) => (
                <li key={c.id} className="text-sm">
                  <p className="font-semibold">
                    {fecha(c.controlledOn, timezone)}
                    {c.isq != null && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · ISQ <span className="cifra">{c.isq}</span>
                      </span>
                    )}
                    {c.statusAfter && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {ETIQUETA_ESTADO_IMPLANTE[c.statusAfter]}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {c.finding}
                    {c.recordedByName ? ` (${c.recordedByName})` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Sin controles registrados.</p>
          )}
          {puedeEditar && (
            <div className="space-y-3">
              <FormularioControl
                clinicId={clinicId}
                patientId={patientId}
                implante={i}
                timezone={timezone}
              />
              <button
                type="button"
                onClick={onEditar}
                className="text-sm font-semibold underline underline-offset-2"
              >
                Corregir los datos del implante
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function FormularioImplante({
  clinicId,
  patientId,
  timezone,
  implante,
  onCerrar,
}: {
  clinicId: string;
  patientId: string;
  timezone: string;
  implante: Implante | null;
  onCerrar: () => void;
}) {
  const fid = useId();
  const profesionalesFn = useServerFn(listProfesionalesClinicos);
  const { data: profesionales = [] } = useQuery({
    queryKey: ["profesionales-clinicos", clinicId],
    queryFn: () => profesionalesFn({ data: { clinicId } }),
    staleTime: 5 * 60_000,
  });
  const [pieza, setPieza] = useState(implante ? String(implante.tooth) : "");
  const [marca, setMarca] = useState(implante?.brand ?? "");
  const [modelo, setModelo] = useState(implante?.model ?? "");
  const [diametro, setDiametro] = useState(
    implante?.diameterMm != null ? String(implante.diameterMm).replace(".", ",") : "",
  );
  const [largo, setLargo] = useState(
    implante?.lengthMm != null ? String(implante.lengthMm).replace(".", ",") : "",
  );
  const [lote, setLote] = useState(implante?.lot ?? "");
  const [referencia, setReferencia] = useState(implante?.reference ?? "");
  const [fechaColocacion, setFechaColocacion] = useState(implante?.placedOn ?? hoyISO(timezone));
  const [profesional, setProfesional] = useState(implante?.professionalId ?? "");
  const [estado, setEstado] = useState<EstadoImplante>(implante?.status ?? "colocado");
  const [notas, setNotas] = useState(implante?.notes ?? "");

  const d = leerMedida(diametro);
  const l = leerMedida(largo);
  const entrada = {
    tooth: /^\d{2}$/.test(pieza.trim()) ? Number(pieza.trim()) : NaN,
    brand: marca,
    model: modelo,
    diameterMm: d ?? undefined,
    lengthMm: l ?? undefined,
    lot: lote,
    reference: referencia,
    placedOn: fechaColocacion,
    professionalId: profesional || undefined,
    status: estado,
    notes: notas,
  };
  const validacion = implanteSchema.safeParse(entrada);
  const errorMedida =
    d === null || l === null ? "Escribe las medidas en mm, con coma o punto (ej. 4,1)." : null;
  const error =
    errorMedida ?? (!validacion.success ? validacion.error.issues[0]?.message : null) ?? null;

  const queryClient = useQueryClient();
  const guardar = useServerFn(guardarImplante);
  const mutacion = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          clinicId,
          patientId,
          ...(implante ? { implantId: implante.id } : {}),
          ...entrada,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["implantes", clinicId, patientId] });
      toast.success(implante ? "Implante corregido." : "Implante registrado.");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const campo = cn(CLASE_CAMPO, "text-base");
  return (
    <div className="mt-4 space-y-4 rounded-[14px] border border-foreground/20 p-4">
      <p className="font-display text-xl font-semibold">
        {implante ? `Corregir implante de la pieza ${implante.tooth}` : "Registrar implante"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-pieza`}>Pieza (FDI)</Label>
          <input
            id={`${fid}-pieza`}
            inputMode="numeric"
            maxLength={2}
            value={pieza}
            onChange={(e) => setPieza(e.target.value.replace(/\D/g, ""))}
            placeholder="36"
            className={campo}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-marca`}>Marca</Label>
          <input
            id={`${fid}-marca`}
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            maxLength={80}
            placeholder="Ej. Straumann"
            className={campo}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-modelo`}>Modelo</Label>
          <input
            id={`${fid}-modelo`}
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            maxLength={80}
            placeholder="Ej. BLT"
            className={campo}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-diametro`}>Ø mm</Label>
            <input
              id={`${fid}-diametro`}
              inputMode="decimal"
              value={diametro}
              onChange={(e) => setDiametro(e.target.value)}
              placeholder="4,1"
              className={campo}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-largo`}>Largo mm</Label>
            <input
              id={`${fid}-largo`}
              inputMode="decimal"
              value={largo}
              onChange={(e) => setLargo(e.target.value)}
              placeholder="10"
              className={campo}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-lote`}>Lote</Label>
          <input
            id={`${fid}-lote`}
            value={lote}
            onChange={(e) => setLote(e.target.value)}
            maxLength={60}
            placeholder="Del envase del implante"
            className={cn(campo, "cifra")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-ref`}>Referencia (opcional)</Label>
          <input
            id={`${fid}-ref`}
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            maxLength={60}
            className={cn(campo, "cifra")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-fecha`}>Fecha de colocación</Label>
          <input
            id={`${fid}-fecha`}
            type="date"
            value={fechaColocacion}
            max={hoyISO(timezone)}
            onChange={(e) => setFechaColocacion(e.target.value)}
            className={campo}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-prof`}>Profesional</Label>
          <select
            id={`${fid}-prof`}
            value={profesional}
            onChange={(e) => setProfesional(e.target.value)}
            className={campo}
          >
            <option value="">Sin indicar</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-estado`}>Estado</Label>
          <select
            id={`${fid}-estado`}
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoImplante)}
            className={campo}
          >
            {ESTADOS_IMPLANTE.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_IMPLANTE[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`${fid}-notas`}>Notas (opcional)</Label>
          <input
            id={`${fid}-notas`}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={1000}
            placeholder="Ej. injerto óseo simultáneo, torque de inserción 35 Ncm"
            className={campo}
          />
        </div>
      </div>
      {error && (marca || lote || pieza) && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-10 items-center rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => mutacion.mutate()}
          disabled={Boolean(error) || mutacion.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50 pointer-coarse:h-11"
        >
          {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {implante ? "Guardar cambios" : "Registrar implante"}
        </button>
      </div>
    </div>
  );
}

function FormularioControl({
  clinicId,
  patientId,
  implante,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  implante: Implante;
  timezone: string;
}) {
  const fid = useId();
  const [fechaControl, setFechaControl] = useState(hoyISO(timezone));
  const [hallazgo, setHallazgo] = useState("");
  const [isq, setIsq] = useState("");
  const [estado, setEstado] = useState<"" | EstadoImplante>("");
  const entrada = {
    controlledOn: fechaControl,
    finding: hallazgo,
    isq: /^\d{1,2}$/.test(isq.trim()) ? Number(isq.trim()) : undefined,
    statusAfter: estado || undefined,
  };
  const valido = controlImplanteSchema.safeParse(entrada).success && !(isq.trim() && !entrada.isq);
  const queryClient = useQueryClient();
  const registrar = useServerFn(registrarControlImplante);
  const mutacion = useMutation({
    mutationFn: () =>
      registrar({ data: { clinicId, patientId, implantId: implante.id, ...entrada } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["implantes", clinicId, patientId] });
      toast.success("Control registrado.");
      setHallazgo("");
      setIsq("");
      setEstado("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const campo = cn(CLASE_CAMPO, "text-base");
  return (
    <div className="space-y-2 rounded-[14px] border border-hairline p-3">
      <p className="text-sm font-semibold">Registrar control</p>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor={`${fid}-fecha`} className="text-[13px]">
            Fecha
          </Label>
          <input
            id={`${fid}-fecha`}
            type="date"
            value={fechaControl}
            max={hoyISO(timezone)}
            onChange={(e) => setFechaControl(e.target.value)}
            className={campo}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fid}-hallazgo`} className="text-[13px]">
            Hallazgo
          </Label>
          <input
            id={`${fid}-hallazgo`}
            value={hallazgo}
            onChange={(e) => setHallazgo(e.target.value)}
            maxLength={1000}
            placeholder="Ej. sin movilidad, encía sana, radiografía sin pérdida ósea"
            className={campo}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fid}-isq`} className="text-[13px]">
            ISQ (opcional)
          </Label>
          <input
            id={`${fid}-isq`}
            inputMode="numeric"
            maxLength={2}
            value={isq}
            onChange={(e) => setIsq(e.target.value.replace(/\D/g, ""))}
            className={cn(campo, "cifra")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fid}-estado`} className="text-[13px]">
            Estado después del control
          </Label>
          <select
            id={`${fid}-estado`}
            value={estado}
            onChange={(e) => setEstado(e.target.value as "" | EstadoImplante)}
            className={campo}
          >
            <option value="">Sin cambio ({ETIQUETA_ESTADO_IMPLANTE[implante.status]})</option>
            {ESTADOS_IMPLANTE.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_IMPLANTE[e]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => mutacion.mutate()}
          disabled={!valido || mutacion.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background disabled:opacity-50 pointer-coarse:h-11"
        >
          {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Guardar control
        </button>
      </div>
    </div>
  );
}
