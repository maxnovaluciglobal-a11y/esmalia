import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MonitorSmartphone, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { CLASE_CAMPO } from "@/components/cita-formulario";
import { ErrorDeCarga } from "@/components/estado-error";
import { ChipOpcion } from "@/components/reserva/piezas";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import {
  ETIQUETA_PRIVACIDAD,
  ETIQUETA_TIPO,
  MODOS_PRIVACIDAD,
  RUTA_TIPO,
  TIPOS_DISPOSITIVO,
  ultimoUsoLegible,
  type ModoPrivacidad,
  type TipoDispositivo,
} from "@/lib/dispositivos/dispositivos";
import {
  crearDispositivo,
  editarDispositivo,
  emitirCodigoDeVinculacion,
  listarDispositivos,
  revocarDispositivo,
  type DatosDispositivos,
  type DispositivoListado,
} from "@/lib/dispositivos/dispositivos.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Ajustes → Dispositivos (Ola 14 · AUT-06): tótem de recepción, TV de la sala
 * de espera y pantalla del box. Se vinculan con un código de un solo uso (10
 * minutos); cada uno recibe su propio token, limitado a su función y su
 * sucursal, sin acceso al resto de la app ni a la ficha. Revocable, con
 * último uso visible. Solo owner y admin (`settings:manage`): el servidor y
 * la base exigen lo mismo.
 */
export const Route = createFileRoute("/_authenticated/_clinic/dispositivos")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [{ title: "Dispositivos | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: DispositivosPage,
});

function DispositivosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const listarFn = useServerFn(listarDispositivos);
  const q = useQuery({
    queryKey: ["dispositivos", clinicId],
    queryFn: () => listarFn({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
  });
  return (
    <AppShell title="Dispositivos" access={access}>
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-2">
          <p className="kicker">Agenda y reservas</p>
          <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-medium leading-[0.95] tracking-[-0.02em]">
            Tablets y <em className="text-brand-600">pantallas</em> de la clínica
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            El tótem deja que el paciente marque su llegada, agende y vea su saldo. La TV de la sala
            muestra a quién se llama (solo turno e iniciales, nunca el RUT ni el motivo). La
            pantalla del box muestra la cita actual y la siguiente. Ninguno puede abrir fichas ni el
            resto de Esmalia.
          </p>
        </header>
        {!clinicId ? null : q.isError ? (
          <ErrorDeCarga onReintentar={() => void q.refetch()} />
        ) : q.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <Contenido clinicId={clinicId} datos={q.data} />
        )}
      </div>
    </AppShell>
  );
}

function Contenido({ clinicId, datos }: { clinicId: string; datos: DatosDispositivos }) {
  const vigentes = datos.dispositivos.filter((d) => d.estado !== "revocado");
  const revocados = datos.dispositivos.filter((d) => d.estado === "revocado");
  return (
    <>
      <NuevoDispositivo clinicId={clinicId} datos={datos} />
      <section aria-labelledby="disp-lista" className="space-y-3">
        <h2 id="disp-lista" className="kicker">
          Vinculados y por vincular
        </h2>
        {vigentes.length === 0 ? (
          <p className="text-muted-foreground">Todavía no agregas dispositivos.</p>
        ) : (
          <ul className="space-y-3">
            {vigentes.map((d) => (
              <FilaDispositivo key={d.id} clinicId={clinicId} d={d} />
            ))}
          </ul>
        )}
      </section>
      {revocados.length > 0 && (
        <details className="rounded-lg border border-border px-4 py-3">
          <summary className="cursor-pointer font-medium">Revocados ({revocados.length})</summary>
          <ul className="mt-3 divide-y divide-hairline">
            {revocados.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>
                  {d.nombre} · {ETIQUETA_TIPO[d.tipo].nombre} · {d.sucursal}
                </span>
                <span className="text-muted-foreground">
                  Último uso: {ultimoUsoLegible(d.ultimoUso)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function NuevoDispositivo({ clinicId, datos }: { clinicId: string; datos: DatosDispositivos }) {
  const fid = useId();
  const qc = useQueryClient();
  const crearFn = useServerFn(crearDispositivo);
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoDispositivo>("totem");
  const [nombre, setNombre] = useState("");
  const [sucursalId, setSucursalId] = useState(datos.sucursales[0]?.id ?? "");
  const [boxId, setBoxId] = useState<string>("");
  const [privacidad, setPrivacidad] = useState<ModoPrivacidad>("iniciales");
  const boxes = datos.boxes.filter((b) => b.sucursalId === sucursalId);

  const crear = useMutation({
    mutationFn: () =>
      crearFn({
        data: {
          clinicId,
          sucursalId,
          tipo,
          nombre: nombre.trim() || ETIQUETA_TIPO[tipo].nombre,
          boxId: tipo === "box" ? boxId || null : null,
          privacidad,
        },
      }),
    onSuccess: () => {
      toast.success("Dispositivo agregado. Genera su código para vincularlo.");
      setAbierto(false);
      setNombre("");
      void qc.invalidateQueries({ queryKey: ["dispositivos", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (!abierto) {
    return (
      <BloqueoEscritura>
        <Button onClick={() => setAbierto(true)} disabled={datos.sucursales.length === 0}>
          <Plus className="size-4" aria-hidden /> Agregar dispositivo
        </Button>
      </BloqueoEscritura>
    );
  }

  return (
    <section
      aria-labelledby={`${fid}-titulo`}
      className="space-y-5 rounded-xl border border-border bg-card p-5"
    >
      <h2 id={`${fid}-titulo`} className="font-display text-2xl font-semibold">
        Nuevo dispositivo
      </h2>
      <div className="space-y-2">
        <p className="text-sm font-medium">Tipo</p>
        <div className="flex flex-wrap gap-2">
          {TIPOS_DISPOSITIVO.map((t) => (
            <ChipOpcion key={t} activo={tipo === t} onClick={() => setTipo(t)}>
              {ETIQUETA_TIPO[t].nombre}
            </ChipOpcion>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{ETIQUETA_TIPO[tipo].detalle}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-nombre`}>Nombre</Label>
          <input
            id={`${fid}-nombre`}
            value={nombre}
            maxLength={60}
            placeholder={ETIQUETA_TIPO[tipo].nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={CLASE_CAMPO}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-sucursal`}>Sucursal</Label>
          <select
            id={`${fid}-sucursal`}
            value={sucursalId}
            onChange={(e) => {
              setSucursalId(e.target.value);
              setBoxId("");
            }}
            className={CLASE_CAMPO}
          >
            {datos.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        {tipo === "box" && (
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-box`}>Box que muestra</Label>
            <select
              id={`${fid}-box`}
              value={boxId}
              onChange={(e) => setBoxId(e.target.value)}
              className={CLASE_CAMPO}
            >
              <option value="">Elige un box</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {tipo === "sala" && <SelectorPrivacidad valor={privacidad} onCambiar={setPrivacidad} />}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => crear.mutate()}
          disabled={crear.isPending || !sucursalId || (tipo === "box" && !boxId)}
        >
          {crear.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Agregar
        </Button>
        <Button variant="outline" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

function SelectorPrivacidad({
  valor,
  onCambiar,
}: {
  valor: ModoPrivacidad;
  onCambiar: (m: ModoPrivacidad) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Cómo aparece el paciente en la TV</p>
      <div className="flex flex-wrap gap-2">
        {MODOS_PRIVACIDAD.map((m) => (
          <ChipOpcion
            key={m}
            activo={valor === m}
            onClick={() => onCambiar(m)}
            detalle={ETIQUETA_PRIVACIDAD[m].ejemplo}
          >
            {ETIQUETA_PRIVACIDAD[m].nombre}
          </ChipOpcion>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Nunca se muestran el RUT ni el motivo.</p>
    </div>
  );
}

const ETIQUETA_ESTADO: Record<DispositivoListado["estado"], string> = {
  sin_vincular: "Sin vincular",
  codigo_vigente: "Código vigente",
  vinculado: "Vinculado",
  revocado: "Revocado",
};

function FilaDispositivo({ clinicId, d }: { clinicId: string; d: DispositivoListado }) {
  const qc = useQueryClient();
  const codigoFn = useServerFn(emitirCodigoDeVinculacion);
  const revocarFn = useServerFn(revocarDispositivo);
  const editarFn = useServerFn(editarDispositivo);
  const [codigo, setCodigo] = useState<{ codigo: string; venceEn: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const invalidar = () => void qc.invalidateQueries({ queryKey: ["dispositivos", clinicId] });

  const emitir = useMutation({
    mutationFn: () => codigoFn({ data: { clinicId, deviceId: d.id } }),
    onSuccess: (r) => {
      setCodigo(r);
      invalidar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const revocar = useMutation({
    mutationFn: () => revocarFn({ data: { clinicId, deviceId: d.id } }),
    onSuccess: () => {
      toast.success(`${d.nombre} quedó revocado: deja de funcionar en su próxima consulta.`);
      setCodigo(null);
      invalidar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const privacidad = useMutation({
    mutationFn: (m: ModoPrivacidad) =>
      editarFn({
        data: { clinicId, deviceId: d.id, nombre: d.nombre, boxId: d.boxId, privacidad: m },
      }),
    onSuccess: () => {
      toast.success("Privacidad de la TV guardada.");
      invalidar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const ruta = RUTA_TIPO[d.tipo];

  return (
    <li className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MonitorSmartphone className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold leading-tight">{d.nombre}</p>
            <p className="text-sm text-muted-foreground">
              {ETIQUETA_TIPO[d.tipo].nombre} · {d.sucursal}
              {d.box && ` · ${d.box}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold",
            d.estado === "vinculado"
              ? "border-success-border bg-success-soft"
              : d.estado === "codigo_vigente"
                ? "border-warning-border bg-warning-soft"
                : "border-border text-muted-foreground",
          )}
        >
          {ETIQUETA_ESTADO[d.estado]}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Último uso</dt>
        <dd>{ultimoUsoLegible(d.ultimoUso)}</dd>
        <dt className="text-muted-foreground">Dirección</dt>
        <dd className="cifra break-all">{ruta}</dd>
      </dl>

      {codigo && (
        <div className="rounded-xl bg-night p-5 text-on-night" role="status">
          <p className="text-sm text-on-night-2">
            Abre <span className="cifra">{ruta}</span> en el dispositivo y escribe este código.
            Vence a las{" "}
            {new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(
              new Date(codigo.venceEn),
            )}{" "}
            y sirve una sola vez. No se vuelve a mostrar.
          </p>
          <p className="cifra mt-3 text-4xl tracking-[0.15em] sm:text-5xl">{codigo.codigo}</p>
        </div>
      )}

      {d.tipo === "sala" && (
        <SelectorPrivacidad valor={d.privacidad} onCambiar={(m) => privacidad.mutate(m)} />
      )}

      <div className="flex flex-wrap gap-2">
        <BloqueoEscritura>
          <Button variant="outline" onClick={() => emitir.mutate()} disabled={emitir.isPending}>
            {emitir.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {d.estado === "vinculado" ? "Vincular otro equipo" : "Generar código"}
          </Button>
        </BloqueoEscritura>
        {confirmando ? (
          <>
            <Button
              variant="destructive"
              onClick={() => revocar.mutate()}
              disabled={revocar.isPending}
            >
              Sí, revocar {d.nombre}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmando(false)}>
              No
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmando(true)}>
            Revocar
          </Button>
        )}
      </div>
      {d.estado === "vinculado" && !codigo && (
        <p className="text-xs text-muted-foreground">
          Vincular otro equipo reemplaza al actual cuando se use el código nuevo.
        </p>
      )}
    </li>
  );
}
