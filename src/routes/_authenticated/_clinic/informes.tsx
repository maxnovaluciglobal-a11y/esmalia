import { useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/app-shell";
import { FiltroCompacto } from "@/components/a-plus/lista";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  Chips,
  Destacado,
  EncabezadoEditorial,
  SelectorPeriodo,
  TintaCargando,
} from "@/components/reportes/aplus";
import { VistaAgenda } from "@/components/reportes/informes/agenda";
import type { ContextoInforme, PedidoDetalle } from "@/components/reportes/informes/comunes";
import { Constructor, type EstadoConstructor } from "@/components/reportes/informes/constructor";
import { DetalleDeCifra } from "@/components/reportes/informes/detalle";
import { VistaEmbudo } from "@/components/reportes/informes/embudo";
import { VistaEquipo, VistaRed } from "@/components/reportes/informes/equipo-y-red";
import { VistaPacientes } from "@/components/reportes/informes/pacientes";
import { ResumenComparado } from "@/components/reportes/informes/resumen";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { requirePermission } from "@/lib/access/route-guards";
import { informesBloqueados } from "@/lib/billing";
import { getMySubscription } from "@/lib/billing.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { nombreDelPeriodo, periodoActivo, rangoDePeriodo } from "@/lib/finance/periodos-reporte";
import {
  CORTES,
  METRICAS,
  corteAdmitido,
  rangoDeConfig,
  type ConfigInforme,
  type Corte,
  type Metrica,
  type ModoComparacion,
} from "@/lib/reportes/informes";
import { getOpcionesInformes, type OpcionesInformes } from "@/lib/reportes/informes.functions";
import { str } from "@/lib/search";

/**
 * Informes "por pregunta" (Ola 11 · frente A, INF-02 a INF-12). Una sola
 * pantalla con una vista por pregunta; todo el estado vive en la URL para
 * que un informe se pueda compartir con un enlace. El permiso de cada cifra
 * lo decide el servidor (y la base): acá solo se ocultan las vistas que el
 * rol no puede abrir.
 */

const VISTAS = [
  "resumen",
  "constructor",
  "agenda",
  "embudo",
  "pacientes",
  "equipo",
  "sucursales",
] as const;
type Vista = (typeof VISTAS)[number];

const ETIQUETA_VISTA: Record<Vista, string> = {
  resumen: "Cómo vamos",
  constructor: "Arma tu informe",
  agenda: "Agenda y boxes",
  embudo: "Embudo",
  pacientes: "Pacientes",
  equipo: "Equipo",
  sucursales: "Sucursales",
};

const PREGUNTA: Record<Vista, ReactNode> = {
  resumen: (
    <>
      ¿Vamos <Destacado>mejor o peor</Destacado> que antes?
    </>
  ),
  constructor: (
    <>
      Elige qué medir y <Destacado>cómo separarlo</Destacado>
    </>
  ),
  agenda: (
    <>
      ¿Cuándo está <Destacado>llena</Destacado> la agenda?
    </>
  ),
  embudo: (
    <>
      ¿Dónde se <Destacado>pierden</Destacado> los pacientes nuevos?
    </>
  ),
  pacientes: (
    <>
      ¿Quiénes son <Destacado>tus pacientes</Destacado>?
    </>
  ),
  equipo: (
    <>
      ¿Cómo le va a <Destacado>cada profesional</Destacado>?
    </>
  ),
  sucursales: (
    <>
      ¿Cómo se comparan las <Destacado>sucursales</Destacado>?
    </>
  ),
};

interface InformesSearch {
  vista: Vista;
  desde?: string;
  hasta?: string;
  sucursal?: string;
  profesional?: string;
  metrica: Metrica;
  corte: Corte;
  corte2: Corte;
  comparar?: ModoComparacion;
}

function de<T extends string>(lista: readonly T[], v: unknown, defecto: T): T {
  return typeof v === "string" && (lista as readonly string[]).includes(v) ? (v as T) : defecto;
}
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function opcional(v: unknown, re: RegExp): string | undefined {
  const s = str(v);
  return re.test(s) ? s : undefined;
}

export const Route = createFileRoute("/_authenticated/_clinic/informes")({
  // Las fechas por defecto se calculan en el componente con la zona de la
  // clínica (regla 7): acá no hay contexto de la clínica todavía.
  validateSearch: (s: Record<string, unknown>): InformesSearch => {
    const metrica = de(METRICAS, s.metrica, "atenciones");
    const corte = de(CORTES, s.corte, "profesional");
    const corte2 = de(CORTES, s.corte2, "total");
    return {
      vista: de(VISTAS, s.vista, "resumen"),
      desde: opcional(s.desde, DIA),
      hasta: opcional(s.hasta, DIA),
      sucursal: opcional(s.sucursal, UUID),
      profesional: opcional(s.profesional, UUID),
      metrica,
      corte: corteAdmitido(metrica, corte) ? corte : "total",
      corte2: corteAdmitido(metrica, corte2) && corte2 !== corte ? corte2 : "total",
      comparar: s.comparar === "anterior" || s.comparar === "anio" ? s.comparar : undefined,
    };
  },
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [
      { title: "Informes | Esmalia" },
      {
        name: "description",
        content:
          "Informes por pregunta: comparación entre períodos, constructor libre, ocupación de la agenda, boxes, embudo, pacientes, equipo y sucursales.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InformesPage,
});

function vistasPara(o: OpcionesInformes): Vista[] {
  return VISTAS.filter((v) => {
    if (v === "resumen" || v === "constructor") return o.metricas.length > 0;
    if (v === "agenda" || v === "equipo") return o.agenda;
    if (v === "embudo") return o.agenda && o.pacientes;
    if (v === "pacientes") return o.pacientes;
    if (v === "sucursales") return o.agenda && o.pacientes;
    return false;
  });
}

function InformesPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const timezone = access.clinic?.timezone ?? "America/Santiago";
  const hoy = hoyISO(timezone);
  const porDefecto = rangoDePeriodo("mes", hoy)!;
  const desde = search.desde ?? porDefecto.desde;
  const hasta = search.hasta ?? porDefecto.hasta;
  const [detalle, setDetalle] = useState<PedidoDetalle | null>(null);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchOpciones = useServerFn(getOpcionesInformes);
  const opciones = useQuery({
    queryKey: ["informes-opciones", clinicId],
    queryFn: () => fetchOpciones({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !bloqueado,
    staleTime: 5 * 60 * 1000,
  });

  const set = (patch: Partial<InformesSearch>) =>
    navigate({ search: (prev: InformesSearch) => ({ ...prev, ...patch }), replace: true });

  const vistas = opciones.data ? vistasPara(opciones.data) : [];
  const vista: Vista = vistas.includes(search.vista) ? search.vista : (vistas[0] ?? "resumen");
  const metrica: Metrica =
    opciones.data && !opciones.data.metricas.includes(search.metrica)
      ? (opciones.data.metricas[0] ?? search.metrica)
      : search.metrica;

  const ctx: ContextoInforme | null =
    clinicId && opciones.data
      ? {
          clinicId,
          desde,
          hasta,
          sucursal: search.sucursal ?? null,
          profesional:
            vista === "equipo" || vista === "sucursales" ? null : (search.profesional ?? null),
          currency: opciones.data.currency,
          timezone,
          rol: access.role ?? null,
          opciones: opciones.data,
          onDetalle: setDetalle,
        }
      : null;

  const estadoConstructor: EstadoConstructor = {
    metrica,
    corte: corteAdmitido(metrica, search.corte) ? search.corte : "total",
    corte2: corteAdmitido(metrica, search.corte2) ? search.corte2 : "total",
    comparar: search.comparar ?? null,
  };

  const abrirGuardado = (c: ConfigInforme) => {
    const r = rangoDeConfig(c, hoy);
    set({
      vista: "constructor",
      metrica: c.metrica,
      corte: c.corte,
      corte2: c.corte2,
      comparar: c.comparar ?? undefined,
      desde: r.desde,
      hasta: r.hasta,
      sucursal: c.sucursal ?? undefined,
      profesional: c.profesional ?? undefined,
    });
  };

  const muestraProfesional = vista !== "equipo" && vista !== "sucursales" && vista !== "embudo";
  const muestraSucursal = vista !== "sucursales" && (opciones.data?.sucursales.length ?? 0) > 1;

  return (
    <AppShell title="Informes" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Informes" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="space-y-4 pb-2">
            <EncabezadoEditorial
              seccion="Reportes"
              pagina="Informes"
              detalle={`${ETIQUETA_VISTA[vista]} · ${nombreDelPeriodo(desde, hasta, hoy)}`}
              titulo={PREGUNTA[vista]}
              conclusion="Toca cualquier cifra para ver los registros que la componen."
            />
            {vistas.length > 0 && (
              <Chips<Vista>
                etiqueta="Pregunta"
                className="no-imprimir"
                valor={vista}
                onCambiar={(v) => set({ vista: v })}
                opciones={vistas.map((v) => ({ valor: v, label: ETIQUETA_VISTA[v] }))}
              />
            )}
            <div className="no-imprimir flex flex-wrap items-center gap-x-4 gap-y-3">
              <SelectorPeriodo
                desde={desde}
                hasta={hasta}
                hoy={hoy}
                onCambiar={(r) => set({ desde: r.desde ?? desde, hasta: r.hasta ?? hasta })}
              />
              {muestraSucursal && opciones.data && (
                <FiltroCompacto
                  etiqueta="Sucursal"
                  todas="Todas las sucursales"
                  valor={search.sucursal ?? ""}
                  onChange={(v) => set({ sucursal: v || undefined })}
                  opciones={opciones.data.sucursales.map((s) => ({ value: s.id, label: s.nombre }))}
                />
              )}
              {muestraProfesional && opciones.data && opciones.data.profesionales.length > 1 && (
                <FiltroCompacto
                  etiqueta="Profesional"
                  todas="Todo el equipo"
                  valor={search.profesional ?? ""}
                  onChange={(v) => set({ profesional: v || undefined })}
                  opciones={opciones.data.profesionales.map((p) => ({
                    value: p.id,
                    label: p.nombre,
                  }))}
                />
              )}
            </div>
          </div>

          {opciones.error ? (
            <ErrorDeCarga
              mensaje="No pudimos abrir los informes."
              onReintentar={() => void opciones.refetch()}
            />
          ) : !ctx ? (
            <TintaCargando texto="Preparando los informes…" />
          ) : vistas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tu rol no tiene informes disponibles.</p>
          ) : (
            <>
              {vista === "resumen" && (
                <ResumenComparado
                  ctx={ctx}
                  modo={search.comparar ?? "anterior"}
                  onModo={(m) => set({ comparar: m })}
                />
              )}
              {vista === "constructor" && (
                <Constructor
                  ctx={ctx}
                  estado={estadoConstructor}
                  periodo={periodoActivo(desde, hasta, hoy)}
                  onCambiar={(e) =>
                    set({
                      ...(e.metrica ? { metrica: e.metrica } : {}),
                      ...(e.corte ? { corte: e.corte } : {}),
                      ...(e.corte2 ? { corte2: e.corte2 } : {}),
                      ...("comparar" in e ? { comparar: e.comparar ?? undefined } : {}),
                    })
                  }
                  onAbrirGuardado={abrirGuardado}
                />
              )}
              {vista === "agenda" && <VistaAgenda ctx={ctx} />}
              {vista === "embudo" && <VistaEmbudo ctx={ctx} />}
              {vista === "pacientes" && <VistaPacientes ctx={ctx} />}
              {vista === "equipo" && <VistaEquipo ctx={ctx} />}
              {vista === "sucursales" && <VistaRed ctx={ctx} />}
              <DetalleDeCifra ctx={ctx} pedido={detalle} onCerrar={() => setDetalle(null)} />
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
