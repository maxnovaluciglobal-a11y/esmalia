import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { ChipFiltro, EncabezadoEditorial } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { BandejaDeTareas } from "@/components/seguimiento/bandeja-de-tareas";
import { CasosDetenidos, RiesgoDeAbandono } from "@/components/seguimiento/casos-y-riesgo";
import { ControlesPendientes } from "@/components/seguimiento/controles-pendientes";
import {
  NuevaTareaDialog,
  type MiembroAsignable,
} from "@/components/seguimiento/nueva-tarea-dialog";
import { ResumenEnTinta } from "@/components/seguimiento/piezas";
import { hasPermission } from "@/lib/access/access";
import { listClinicMembers } from "@/lib/access/access.functions";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { listPresupuestosSinRespuesta } from "@/lib/messaging/messaging.functions";
import { DIAS_DETENIDO_POR_DEFECTO } from "@/lib/seguimiento/detenidos";
import {
  listCasosDetenidos,
  listControlesPendientes,
  listRiesgoDeAbandono,
  listTareas,
} from "@/lib/seguimiento/seguimiento.functions";
import { agruparBandeja, filtrarPorPersona } from "@/lib/seguimiento/tareas";

const VISTAS = ["tareas", "controles", "detenidos", "riesgo"] as const;
type Vista = (typeof VISTAS)[number];

/**
 * Seguimiento de pacientes (Ola 8 · frente B): una sola pantalla para lo que
 * hay que hacer con los pacientes que no están en la agenda de hoy.
 *  - Tareas (CRM-02): bandeja por persona, con presupuestos sin respuesta.
 *  - Controles (REC-08 + FIC-13): programados desde la ficha y recall.
 *  - Detenidos (CRM-06): planes aceptados sin avance o a medias.
 *  - Riesgo (CRM-07): puntaje explicable de abandono.
 * Arriba, en tinta, lo que requiere acción. Mismo permiso que Recordatorios
 * (`agenda:manage`); la RLS de las tablas nuevas pide los mismos roles.
 */
export const Route = createFileRoute("/_authenticated/_clinic/seguimiento")({
  beforeLoad: requirePermission("agenda:manage"),
  validateSearch: (search: Record<string, unknown>): { vista: Vista } => ({
    vista: VISTAS.includes(search.vista as Vista) ? (search.vista as Vista) : "tareas",
  }),
  head: () => ({
    meta: [
      { title: "Seguimiento | Esmalia" },
      {
        name: "description",
        content:
          "Tareas del equipo, controles pendientes, tratamientos detenidos y pacientes con riesgo de abandono.",
      },
    ],
  }),
  component: SeguimientoPage,
});

const ETIQUETA_VISTA: Record<Vista, string> = {
  tareas: "Tareas",
  controles: "Controles",
  detenidos: "Tratamientos detenidos",
  riesgo: "Riesgo de abandono",
};

function SeguimientoPage() {
  const { access } = Route.useRouteContext();
  const { vista } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const clinicId = access.clinic?.id ?? "";
  const zona = access.clinic?.timezone ?? "America/Santiago";
  const hoy = hoyISO(zona);
  const userId = access.userId;
  const [dias, setDias] = useState<number>(DIAS_DETENIDO_POR_DEFECTO);
  const [nuevaTarea, setNuevaTarea] = useState(false);

  const fTareas = useServerFn(listTareas);
  const tareas = useQuery({
    queryKey: ["seguimiento-tareas", clinicId],
    queryFn: () => fTareas({ data: { clinicId, cerradasDias: 7 } }),
    enabled: Boolean(clinicId),
  });
  const fMiembros = useServerFn(listClinicMembers);
  const miembrosQ = useQuery({
    queryKey: ["clinic-members", clinicId],
    queryFn: () => fMiembros({ data: { clinicId } }),
    enabled: Boolean(clinicId),
    staleTime: 5 * 60_000,
  });
  const fPresupuestos = useServerFn(listPresupuestosSinRespuesta);
  const presupuestos = useQuery({
    queryKey: ["presupuestos-sin-respuesta", clinicId, "seguimiento"],
    queryFn: () => fPresupuestos({ data: { clinicId } }),
    enabled: Boolean(clinicId),
  });
  const fControles = useServerFn(listControlesPendientes);
  const controles = useQuery({
    queryKey: ["seguimiento-controles", clinicId],
    queryFn: () => fControles({ data: { clinicId } }),
    enabled: Boolean(clinicId),
  });
  const fDetenidos = useServerFn(listCasosDetenidos);
  const detenidos = useQuery({
    queryKey: ["seguimiento-detenidos", clinicId, dias],
    queryFn: () => fDetenidos({ data: { clinicId, dias } }),
    enabled: Boolean(clinicId),
  });
  const fRiesgo = useServerFn(listRiesgoDeAbandono);
  const riesgo = useQuery({
    queryKey: ["seguimiento-riesgo", clinicId],
    queryFn: () => fRiesgo({ data: { clinicId } }),
    enabled: Boolean(clinicId),
    staleTime: 60_000,
  });

  const miembros = useMemo<MiembroAsignable[]>(
    () =>
      (miembrosQ.data ?? [])
        .filter((m) => hasPermission(m.role, "agenda:manage"))
        .map((m) => ({
          userId: m.userId,
          nombre: m.fullName || m.email || "Integrante del equipo",
        })),
    [miembrosQ.data],
  );

  const refrescar = () => {
    for (const k of [
      "seguimiento-tareas",
      "seguimiento-controles",
      "seguimiento-detenidos",
      "seguimiento-riesgo",
    ]) {
      queryClient.invalidateQueries({ queryKey: [k, clinicId] });
    }
  };

  const listaTareas = tareas.data ?? [];
  const misTareas = agruparBandeja(filtrarPorPersona(listaTareas, "mias", userId), hoy);
  const todasPendientes = agruparBandeja(listaTareas, hoy);
  const controlesVencidos = (controles.data?.controles ?? []).filter(
    (c) => !c.tieneCita && c.vencimiento === "vencido",
  ).length;
  const riesgoAlto = (riesgo.data?.pacientes ?? []).filter((p) => p.riesgo.nivel === "alto").length;

  const conteoVista: Record<Vista, number | null> = {
    tareas: tareas.data
      ? todasPendientes.vencidas.length +
        todasPendientes.hoy.length +
        todasPendientes.proximas.length
      : null,
    controles: controles.data ? controles.data.controles.filter((c) => !c.tieneCita).length : null,
    detenidos: detenidos.data ? detenidos.data.length : null,
    riesgo: riesgo.data ? riesgoAlto : null,
  };

  const ir = (v: Vista) => navigate({ search: { vista: v }, replace: true });

  const tareasDeControl = listaTareas.filter(
    (t) => t.status === "pendiente" && t.kind === "control",
  );
  const conTarea = {
    controles: new Set(tareasDeControl.map((t) => t.controlId).filter((x): x is string => !!x)),
    pacientes: new Set(tareasDeControl.map((t) => t.patientId).filter((x): x is string => !!x)),
  };

  return (
    <AppShell title="Seguimiento" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={["Mensajes", access.clinic?.name ?? ""]}
          titulo="Seguimiento de"
          enfasis="pacientes"
        >
          <p className="mt-3 max-w-[68ch] text-[15px] text-muted-foreground">
            Lo que hay que hacer con quienes no están en la agenda: tareas del equipo, controles que
            vencen, tratamientos que se detuvieron y pacientes que podrías perder.{" "}
            <b className="font-semibold text-foreground">Nada sale solo:</b> cada mensaje lo revisas
            y lo mandas tú.
          </p>
        </EncabezadoEditorial>

        <ResumenEnTinta
          titulo="Lo que requiere"
          enfasis="acción"
          bajada={
            tareas.data
              ? `${misTareas.vencidas.length + misTareas.hoy.length} tuyas para hoy o atrasadas`
              : undefined
          }
          cifras={[
            {
              id: "vencidas",
              etiqueta: "Tareas vencidas",
              valor: tareas.data ? todasPendientes.vencidas.length : null,
              urgente: true,
              onClick: () => ir("tareas"),
              activo: vista === "tareas",
            },
            {
              id: "hoy",
              etiqueta: "Tareas para hoy",
              valor: tareas.data ? todasPendientes.hoy.length : null,
              onClick: () => ir("tareas"),
            },
            {
              id: "controles",
              etiqueta: "Controles vencidos",
              valor: controles.data ? controlesVencidos : null,
              urgente: true,
              onClick: () => ir("controles"),
              activo: vista === "controles",
            },
            {
              id: "detenidos",
              etiqueta: "Tratamientos detenidos",
              valor: detenidos.data ? detenidos.data.length : null,
              onClick: () => ir("detenidos"),
              activo: vista === "detenidos",
            },
            {
              id: "riesgo",
              etiqueta: "Riesgo alto de abandono",
              valor: riesgo.data ? riesgoAlto : null,
              urgente: true,
              onClick: () => ir("riesgo"),
              activo: vista === "riesgo",
            },
          ]}
        />

        <div role="group" aria-label="Qué ver" className="flex flex-wrap gap-1.5">
          {VISTAS.map((v) => (
            <ChipFiltro key={v} activo={vista === v} onClick={() => ir(v)}>
              {ETIQUETA_VISTA[v]}
              {conteoVista[v] !== null && (
                <span className="cifra text-[11px] opacity-75">{conteoVista[v]}</span>
              )}
            </ChipFiltro>
          ))}
        </div>

        {vista === "tareas" &&
          (tareas.isPending ? (
            <Cargando />
          ) : tareas.isError ? (
            <ErrorDeCarga
              onReintentar={() => tareas.refetch()}
              mensaje={mensajeDeError(tareas.error)}
            />
          ) : (
            <BandejaDeTareas
              clinicId={clinicId}
              userId={userId}
              hoy={hoy}
              zona={zona}
              tareas={listaTareas}
              miembros={miembros}
              presupuestos={presupuestos.data ?? []}
              onCambio={refrescar}
              onNueva={() => setNuevaTarea(true)}
            />
          ))}

        {vista === "controles" &&
          (controles.isPending ? (
            <Cargando />
          ) : controles.isError ? (
            <ErrorDeCarga
              onReintentar={() => controles.refetch()}
              mensaje={mensajeDeError(controles.error)}
            />
          ) : (
            <ControlesPendientes
              clinicId={clinicId}
              userId={userId}
              hoy={hoy}
              zona={zona}
              controles={controles.data.controles}
              reservaEncendida={controles.data.reservaEncendida}
              conTarea={conTarea}
              onCambio={refrescar}
            />
          ))}

        {vista === "detenidos" &&
          (detenidos.isPending ? (
            <Cargando />
          ) : detenidos.isError ? (
            <ErrorDeCarga
              onReintentar={() => detenidos.refetch()}
              mensaje={mensajeDeError(detenidos.error)}
            />
          ) : (
            <CasosDetenidos
              clinicId={clinicId}
              userId={userId}
              hoy={hoy}
              zona={zona}
              dias={dias}
              onDias={setDias}
              casos={detenidos.data}
              onCambio={refrescar}
            />
          ))}

        {vista === "riesgo" &&
          (riesgo.isPending ? (
            <Cargando />
          ) : riesgo.isError ? (
            <ErrorDeCarga
              onReintentar={() => riesgo.refetch()}
              mensaje={mensajeDeError(riesgo.error)}
            />
          ) : (
            <RiesgoDeAbandono
              clinicId={clinicId}
              userId={userId}
              hoy={hoy}
              zona={zona}
              pacientes={riesgo.data.pacientes}
              sinDatos={riesgo.data.sinDatos}
              saldoConocido={riesgo.data.saldoConocido}
              onCambio={refrescar}
            />
          ))}
      </div>

      {clinicId && (
        <NuevaTareaDialog
          clinicId={clinicId}
          hoy={hoy}
          userId={userId}
          miembros={miembros}
          abierto={nuevaTarea}
          onAbiertoChange={setNuevaTarea}
          onCreada={refrescar}
        />
      )}
    </AppShell>
  );
}

function Cargando() {
  return (
    <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
    </p>
  );
}
