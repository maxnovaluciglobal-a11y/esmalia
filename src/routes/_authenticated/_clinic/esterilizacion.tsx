import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  CheckCircle2,
  Clock,
  Hourglass,
  PackageCheck,
  Plus,
  Printer,
  ScanLine,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  BarraApilada,
  Chips,
  CifraEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  FILA,
  PANEL,
  Pastilla,
  SinDatos,
  TablaAPlus,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
  celda,
  type ColumnaTabla,
} from "@/components/reportes/aplus";
import {
  DialogoBajaPaquete,
  DialogoEtiquetar,
  DialogoLecturaCiclo,
  DialogoRegistrarCiclo,
  DialogoUsarPaquete,
  imprimirEtiquetas,
} from "@/components/esterilizacion/dialogos";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import type { TonoEstado } from "@/lib/clinic-operations/estado-cita-tono";
import {
  DIAS_POR_VENCER,
  ETIQUETA_ESTADO_PAQUETE,
  ETIQUETA_INDICADOR,
  ETIQUETA_INDICADOR_BIOLOGICO,
  ETIQUETA_RESULTADO,
  ETIQUETA_TIPO,
  diasParaVencer,
  esPruebaDeEquipo,
  estadoVisible,
  numeroDeCiclo,
  parametrosDeCiclo,
  puedeRegistrarEsterilizacion,
  rastreoDeCiclo,
  resumenEsterilizacion,
  type EstadoVisible,
  type ResultadoCiclo,
} from "@/lib/esterilizacion/esterilizacion";
import {
  listarEsterilizacion,
  type Ciclo,
  type Paquete,
} from "@/lib/esterilizacion/esterilizacion.functions";
import { fechaHoraPlanilla, fechaPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { fecha, fechaCorta, fechaCortaHora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/**
 * Trazabilidad de esterilización (MKT-10, Ola 14), en Operación junto a
 * Inventario y Laboratorios: ciclos de autoclave con sus indicadores,
 * paquetes con etiqueta QR y vencimiento del estéril, uso de cada paquete en
 * un paciente y, si un ciclo falla, a qué pacientes se usó ese instrumental.
 * El registro y el rastreo se exportan en CSV para la autorización sanitaria.
 */

export const Route = createFileRoute("/_authenticated/_clinic/esterilizacion")({
  beforeLoad: requirePermission("inventory:view"),
  head: () => ({
    meta: [
      { title: "Esterilización | Esmalia" },
      {
        name: "description",
        content:
          "Ciclos de autoclave, paquetes con etiqueta y vencimiento, y rastreo de pacientes si un ciclo falla.",
      },
    ],
  }),
  component: EsterilizacionPage,
});

const TONO_RESULTADO: Record<ResultadoCiclo, { tono: TonoEstado; icono: LucideIcon }> = {
  aprobado: { tono: "success", icono: CheckCircle2 },
  pendiente: { tono: "warning", icono: Hourglass },
  fallido: { tono: "danger", icono: XCircle },
};

const TONO_PAQUETE: Record<EstadoVisible, { tono: TonoEstado; icono: LucideIcon }> = {
  disponible: { tono: "success", icono: PackageCheck },
  por_vencer: { tono: "warning", icono: Clock },
  vencido: { tono: "danger", icono: TriangleAlert },
  usado: { tono: "info", icono: CheckCircle2 },
  descartado: { tono: "neutral", icono: Ban },
  retirado: { tono: "neutral", icono: Ban },
};

type FiltroPaquete = "" | "disponibles" | "por_vencer" | "vencidos" | "usados" | "bajas";

const ACCION =
  "inline-flex h-8 items-center gap-1 rounded-full border border-control px-3 text-xs font-semibold hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11";

function EsterilizacionPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;
  const zona = access.clinic?.timezone ?? "America/Santiago";
  const hoy = hoyISO(zona);
  const puedeRegistrar = puedeRegistrarEsterilizacion(access.role);

  const fetchDatos = useServerFn(listarEsterilizacion);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["esterilizacion", clinicId],
    queryFn: () => fetchDatos({ data: { clinicId } }),
  });
  const ciclos = useMemo(() => data?.ciclos ?? [], [data]);
  const paquetes = useMemo(() => data?.paquetes ?? [], [data]);
  const cicloPorId = useMemo(() => new Map(ciclos.map((c) => [c.id, c])), [ciclos]);
  const resumen = useMemo(
    () => resumenEsterilizacion(ciclos, paquetes, hoy, zona),
    [ciclos, paquetes, hoy, zona],
  );

  const [registrar, setRegistrar] = useState(false);
  const [usar, setUsar] = useState(false);
  const [lectura, setLectura] = useState<Ciclo | null>(null);
  const [etiquetar, setEtiquetar] = useState<Ciclo | null>(null);
  const [baja, setBaja] = useState<Paquete | null>(null);
  const [rastreado, setRastreado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPaquete>("disponibles");

  const visibles = paquetes.filter((p) => {
    const e = estadoVisible(p, hoy);
    switch (filtro) {
      case "disponibles":
        return e === "disponible" || e === "por_vencer";
      case "por_vencer":
        return e === "por_vencer";
      case "vencidos":
        return e === "vencido";
      case "usados":
        return e === "usado";
      case "bajas":
        return e === "descartado" || e === "retirado";
      default:
        return true;
    }
  });
  const cuenta = (f: FiltroPaquete) =>
    paquetes.filter((p) => {
      const e = estadoVisible(p, hoy);
      if (f === "disponibles") return e === "disponible" || e === "por_vencer";
      if (f === "por_vencer") return e === "por_vencer";
      if (f === "vencidos") return e === "vencido";
      if (f === "usados") return e === "usado";
      if (f === "bajas") return e === "descartado" || e === "retirado";
      return true;
    }).length;

  // Rastreo: el ciclo elegido o, si no, el primer fallido con instrumental usado.
  const cicloRastreo = rastreado ?? resumen.fallidosConUso[0] ?? null;
  const pacientesRastreados = cicloRastreo ? rastreoDeCiclo(cicloRastreo, paquetes) : [];

  const equipoSugerido = ciclos[0]?.equipment ?? "";

  const columnasCsvCiclos: ColumnaLista<Ciclo>[] = [
    { header: "Número", value: (c) => `${c.number}/${c.year}` },
    { header: "Fecha y hora", value: (c) => fechaHoraPlanilla(c.runAt, zona) },
    { header: "Equipo", value: (c) => c.equipment },
    { header: "N.º de serie", value: (c) => c.equipmentSerial },
    { header: "Tipo", value: (c) => ETIQUETA_TIPO[c.cycleType] },
    { header: "Temperatura (°C)", value: (c) => c.temperatureC },
    { header: "Presión (bar)", value: (c) => c.pressureBar },
    { header: "Exposición (min)", value: (c) => c.exposureMinutes },
    { header: "Indicador químico", value: (c) => ETIQUETA_INDICADOR[c.chemicalIndicator] },
    { header: "Clase del indicador", value: (c) => c.chemicalIndicatorClass },
    {
      header: "Indicador biológico",
      value: (c) => ETIQUETA_INDICADOR_BIOLOGICO[c.biologicalIndicator],
    },
    { header: "Lote biológico", value: (c) => c.biologicalLot },
    { header: "Lectura biológico", value: (c) => fechaHoraPlanilla(c.biologicalReadAt, zona) },
    { header: "Resultado", value: (c) => ETIQUETA_RESULTADO[c.result] },
    { header: "Motivo de falla", value: (c) => c.failureReason },
    { header: "Responsable", value: (c) => c.responsibleName },
    {
      header: "Paquetes",
      value: (c) => paquetes.filter((p) => p.cycleId === c.id).length,
    },
    { header: "Notas", value: (c) => c.notes },
  ];
  const columnasCsvRastreo: ColumnaLista<Paquete>[] = [
    { header: "Código", value: (p) => p.code },
    { header: "Contenido", value: (p) => p.contents },
    {
      header: "Ciclo",
      value: (p) => {
        const c = cicloPorId.get(p.cycleId);
        return c ? `${c.number}/${c.year}` : null;
      },
    },
    {
      header: "Resultado del ciclo",
      value: (p) => {
        const c = cicloPorId.get(p.cycleId);
        return c ? ETIQUETA_RESULTADO[c.result] : null;
      },
    },
    { header: "Vence", value: (p) => fechaPlanilla(p.expiresOn, zona) },
    { header: "Estado", value: (p) => ETIQUETA_ESTADO_PAQUETE[estadoVisible(p, hoy)] },
    { header: "Paciente", value: (p) => p.usedPatientName },
    { header: "Usado", value: (p) => fechaHoraPlanilla(p.usedAt, zona) },
    { header: "Cita", value: (p) => fechaHoraPlanilla(p.usedAppointmentAt, zona) },
    { header: "Motivo de baja", value: (p) => p.discardReason },
  ];

  const total = resumen.ciclosPeriodo;
  const conclusion = isLoading ? undefined : ciclos.length === 0 ? (
    "Todavía no hay ciclos. Registra cada carga del autoclave y etiqueta sus paquetes: si un ciclo falla, sabrás a qué pacientes avisar."
  ) : resumen.fallidosConUso.length > 0 ? (
    <>
      <b className="font-semibold text-destructive">
        {resumen.fallidosConUso.length === 1
          ? "Un ciclo fallido tiene instrumental ya usado en pacientes."
          : `${resumen.fallidosConUso.length} ciclos fallidos tienen instrumental ya usado en pacientes.`}
      </b>{" "}
      Abajo ves a quiénes.
    </>
  ) : (
    <>
      <b className="font-semibold text-foreground">
        {resumen.vencidos === 0
          ? "Ningún paquete vencido."
          : `${resumen.vencidos} ${resumen.vencidos === 1 ? "paquete vencido" : "paquetes vencidos"}: reprocésalos.`}
      </b>{" "}
      {resumen.porVencer > 0 &&
        `${resumen.porVencer} ${resumen.porVencer === 1 ? "vence" : "vencen"} en los próximos ${DIAS_POR_VENCER} días.`}
    </>
  );

  const columnasCiclos: ColumnaTabla[] = [
    { label: "Ciclo" },
    { label: "Equipo y tipo", className: "hidden md:table-cell" },
    { label: "Parámetros", className: "hidden lg:table-cell" },
    { label: "Indicadores", className: "hidden sm:table-cell" },
    { label: "Resultado" },
  ];
  const columnasPaquetes: ColumnaTabla[] = [
    { label: "Paquete" },
    { label: "Ciclo", className: "hidden md:table-cell" },
    { label: "Vence" },
    { label: "Estado" },
  ];

  return (
    <AppShell title="Esterilización" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <div className="pb-2">
          <EncabezadoEditorial
            seccion="Operación"
            pagina="Esterilización"
            titulo={
              <>
                Trazabilidad de <Destacado>esterilización</Destacado>
              </>
            }
            conclusion={conclusion}
            acciones={
              <>
                <ExportarCsvLista<Ciclo>
                  clinicId={clinicId}
                  rol={access.role}
                  lista="esterilizacion"
                  filas={ciclos}
                  columnas={columnasCsvCiclos}
                  timezone={zona}
                />
                <ExportarCsvLista<Paquete>
                  clinicId={clinicId}
                  rol={access.role}
                  lista="esterilizacion_rastreo"
                  filas={paquetes}
                  columnas={columnasCsvRastreo}
                  timezone={zona}
                  archivo="rastreo-de-paquetes"
                />
                {puedeRegistrar && (
                  <BloqueoEscritura>
                    <Button variant="outline" size="sm" onClick={() => setUsar(true)}>
                      <ScanLine className="size-4" /> Usar paquete
                    </Button>
                  </BloqueoEscritura>
                )}
                {puedeRegistrar && (
                  <BloqueoEscritura>
                    <Button size="sm" onClick={() => setRegistrar(true)}>
                      <Plus className="size-4" /> Registrar ciclo
                    </Button>
                  </BloqueoEscritura>
                )}
              </>
            }
          />
        </div>

        {isError ? (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar la esterilización." />
        ) : isLoading ? (
          <TintaCargando texto="Cargando ciclos y paquetes…" />
        ) : (
          <section
            aria-label="Resumen de esterilización"
            className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}
          >
            <div className="min-w-0">
              <EtiquetaTinta>Paquetes estériles disponibles</EtiquetaTinta>
              <CifraEnTinta
                valor={String(resumen.disponibles)}
                sufijo={resumen.disponibles === 1 ? " paquete" : " paquetes"}
              />
              <p className="mt-3.5 text-sm font-medium text-on-night-2">
                {resumen.porVencer === 0 && resumen.vencidos === 0 ? (
                  `ninguno vence en los próximos ${DIAS_POR_VENCER} días`
                ) : (
                  <>
                    <b className="font-semibold text-on-night">{resumen.porVencer} por vencer</b> ·{" "}
                    <b className="font-semibold text-brand-on-night">
                      {resumen.vencidos} {resumen.vencidos === 1 ? "vencido" : "vencidos"}
                    </b>
                  </>
                )}
              </p>
            </div>
            <div className="min-w-0">
              <EtiquetaTinta>Ciclos de los últimos 30 días</EtiquetaTinta>
              <BarraApilada
                sobre="tinta"
                sinPorcentaje
                vacio="Sin ciclos en los últimos 30 días."
                partes={[
                  {
                    clave: "aprobado",
                    etiqueta: "Aprobados",
                    valor: total.aprobados,
                    texto: String(total.aprobados),
                  },
                  {
                    clave: "pendiente",
                    etiqueta: "Pendientes",
                    valor: total.pendientes,
                    texto: String(total.pendientes),
                  },
                  {
                    clave: "fallido",
                    etiqueta: "Fallidos",
                    valor: total.fallidos,
                    texto: String(total.fallidos),
                  },
                ]}
              />
              <p className="mt-4 text-xs leading-relaxed text-on-night-2">
                Si un indicador falla, el ciclo queda fallido, sus paquetes disponibles se retiran
                solos y aquí ves a qué pacientes se usó ese instrumental.
              </p>
            </div>
          </section>
        )}

        {cicloRastreo && cicloPorId.get(cicloRastreo) && (
          <section
            aria-labelledby="rastreo-titulo"
            className={cn(
              PANEL,
              "p-5",
              cicloPorId.get(cicloRastreo)!.result === "fallido" && "border-destructive-border",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="rastreo-titulo" className={TITULO_PANEL}>
                Rastreo del ciclo {numeroDeCiclo(cicloPorId.get(cicloRastreo)!)}
              </h2>
              {rastreado && (
                <button
                  type="button"
                  onClick={() => setRastreado(null)}
                  className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  Cerrar rastreo
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {cicloPorId.get(cicloRastreo)!.result === "fallido"
                ? `Falló: ${cicloPorId.get(cicloRastreo)!.failureReason ?? "sin motivo"}. Contacta a estos pacientes según el protocolo de la clínica.`
                : "Pacientes en que se usaron paquetes de este ciclo."}
            </p>
            {pacientesRastreados.length === 0 ? (
              <p className="mt-3 text-sm">Ningún paquete de este ciclo se usó en pacientes.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {pacientesRastreados.map((r) => (
                  <li
                    key={r.pacienteId}
                    className="rounded-[10px] border border-hairline px-3 py-2"
                  >
                    <Link
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: r.pacienteId }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.paciente}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.paquetes
                        .map((p) => `${p.code} · ${fechaCortaHora(p.citaEn ?? p.usadoEn, zona)}`)
                        .join(" — ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="ciclos-titulo" className={cn(PANEL, "overflow-hidden")}>
          <div className="px-5 pt-[18px] pb-3">
            <h2 id="ciclos-titulo" className={TITULO_PANEL}>
              Ciclos
            </h2>
          </div>
          {!isLoading && ciclos.length === 0 && (
            <SinDatos
              className="border-t border-hairline"
              titulo="Sin ciclos registrados"
              detalle="Registra cada carga del autoclave con sus parámetros e indicadores. Es el libro de esterilización, pero sin papel."
            />
          )}
          {ciclos.length > 0 && (
            <TablaAPlus columnas={columnasCiclos}>
              {ciclos.map((c) => {
                const t = TONO_RESULTADO[c.result];
                const nPaq = paquetes.filter((p) => p.cycleId === c.id).length;
                return (
                  <tr key={c.id} className={FILA}>
                    <td className={celda(0, 5, "min-w-[10rem]")}>
                      <span className="cifra font-medium">{numeroDeCiclo(c)}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {fechaCortaHora(c.runAt, zona)} · {c.responsibleName}
                      </span>
                      <span className="block text-[13px] text-muted-foreground md:hidden">
                        {ETIQUETA_TIPO[c.cycleType]}
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {puedeRegistrar &&
                          (c.result === "pendiente" || c.biologicalIndicator === "pendiente") && (
                            <button type="button" className={ACCION} onClick={() => setLectura(c)}>
                              Registrar lectura
                            </button>
                          )}
                        {puedeRegistrar &&
                          c.result !== "fallido" &&
                          !esPruebaDeEquipo(c.cycleType) && (
                            <button
                              type="button"
                              className={ACCION}
                              onClick={() => setEtiquetar(c)}
                            >
                              Etiquetar paquetes
                            </button>
                          )}
                        {nPaq > 0 && (
                          <button
                            type="button"
                            className={ACCION}
                            onClick={() => setRastreado(c.id)}
                          >
                            Rastrear ({nPaq})
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={celda(1, 5, "hidden md:table-cell")}>
                      {c.equipment}
                      <span className="block text-[13px] text-muted-foreground">
                        {ETIQUETA_TIPO[c.cycleType]}
                      </span>
                    </td>
                    <td
                      className={celda(
                        2,
                        5,
                        "cifra hidden whitespace-nowrap text-[13px] text-muted-foreground lg:table-cell",
                      )}
                    >
                      {parametrosDeCiclo(c) || "—"}
                    </td>
                    <td className={celda(3, 5, "hidden text-[13px] sm:table-cell")}>
                      Químico: {ETIQUETA_INDICADOR[c.chemicalIndicator]}
                      <span className="block text-muted-foreground">
                        Biológico: {ETIQUETA_INDICADOR_BIOLOGICO[c.biologicalIndicator]}
                      </span>
                    </td>
                    <td className={celda(4, 5)}>
                      <Pastilla tono={t.tono} icono={t.icono}>
                        {ETIQUETA_RESULTADO[c.result]}
                      </Pastilla>
                    </td>
                  </tr>
                );
              })}
            </TablaAPlus>
          )}
        </section>

        <section aria-labelledby="paquetes-titulo" className={cn(PANEL, "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3">
            <h2 id="paquetes-titulo" className={TITULO_PANEL}>
              Paquetes
            </h2>
            {paquetes.length > 0 && (
              <Chips<FiltroPaquete>
                etiqueta="Filtrar paquetes"
                valor={filtro}
                onCambiar={setFiltro}
                opciones={[
                  { valor: "disponibles", label: "Disponibles", cuenta: cuenta("disponibles") },
                  { valor: "por_vencer", label: "Por vencer", cuenta: cuenta("por_vencer") },
                  { valor: "vencidos", label: "Vencidos", cuenta: cuenta("vencidos") },
                  { valor: "usados", label: "Usados", cuenta: cuenta("usados") },
                  { valor: "bajas", label: "Bajas", cuenta: cuenta("bajas") },
                  { valor: "", label: "Todos", cuenta: paquetes.length },
                ]}
              />
            )}
          </div>
          {!isLoading && paquetes.length === 0 && (
            <SinDatos
              className="border-t border-hairline"
              titulo="Sin paquetes etiquetados"
              detalle="Después de un ciclo aprobado, etiqueta sus paquetes: cada uno lleva un QR con su código y la fecha de vencimiento."
            />
          )}
          {paquetes.length > 0 && visibles.length === 0 && (
            <SinDatos
              className="border-t border-hairline"
              titulo="Ningún paquete con este filtro."
            />
          )}
          {visibles.length > 0 && (
            <>
              <div className="flex justify-end px-5 pb-2">
                <button
                  type="button"
                  className={ACCION}
                  onClick={() =>
                    imprimirEtiquetas(
                      visibles.filter((p) => p.status === "disponible"),
                      cicloPorId,
                      access.clinic?.name ?? "",
                      zona,
                    )
                  }
                  disabled={!visibles.some((p) => p.status === "disponible")}
                >
                  <Printer aria-hidden className="size-3.5" /> Imprimir etiquetas
                </button>
              </div>
              <TablaAPlus columnas={columnasPaquetes}>
                {visibles.map((p) => {
                  const e = estadoVisible(p, hoy);
                  const t = TONO_PAQUETE[e];
                  const c = cicloPorId.get(p.cycleId);
                  const dias = diasParaVencer(p.expiresOn, hoy);
                  return (
                    <tr key={p.id} className={FILA}>
                      <td className={celda(0, 4, "min-w-[11rem]")}>
                        <span className="cifra font-medium">{p.code}</span>
                        <span className="block text-[13px] text-muted-foreground">
                          {p.contents}
                        </span>
                        {p.usedPatientId && (
                          <span className="block text-[13px]">
                            <Link
                              to="/pacientes/$pacienteId"
                              params={{ pacienteId: p.usedPatientId }}
                              className="underline-offset-4 hover:underline"
                            >
                              {p.usedPatientName}
                            </Link>{" "}
                            <span className="text-muted-foreground">
                              · {fechaCortaHora(p.usedAt, zona)}
                            </span>
                          </span>
                        )}
                        {p.discardReason && (
                          <span className="block text-[13px] text-muted-foreground">
                            {p.discardReason}
                          </span>
                        )}
                        {puedeRegistrar && p.status === "disponible" && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <button type="button" className={ACCION} onClick={() => setBaja(p)}>
                              Dar de baja
                            </button>
                          </div>
                        )}
                      </td>
                      <td
                        className={celda(
                          1,
                          4,
                          "cifra hidden text-[13px] text-muted-foreground md:table-cell",
                        )}
                      >
                        {c ? numeroDeCiclo(c) : "—"}
                      </td>
                      <td className={celda(2, 4, "whitespace-nowrap")}>
                        <span className="cifra text-[13px]">{fechaCorta(p.expiresOn)}</span>
                        {p.status === "disponible" && (
                          <span className="block text-xs text-muted-foreground">
                            {dias < 0
                              ? `venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"}`
                              : dias === 0
                                ? "vence hoy"
                                : `en ${dias} ${dias === 1 ? "día" : "días"}`}
                          </span>
                        )}
                      </td>
                      <td className={celda(3, 4)}>
                        <Pastilla tono={t.tono} icono={t.icono}>
                          {ETIQUETA_ESTADO_PAQUETE[e]}
                        </Pastilla>
                      </td>
                    </tr>
                  );
                })}
              </TablaAPlus>
            </>
          )}
        </section>
        <p className="text-xs text-muted-foreground">
          Nada se borra: un paquete se descarta o se retira con motivo, y un ciclo fallido queda en
          el registro. Datos al {fecha(hoy)}.
        </p>
      </div>

      {registrar && (
        <DialogoRegistrarCiclo
          clinicId={clinicId}
          zona={zona}
          responsable={access.fullName ?? ""}
          equipoSugerido={equipoSugerido}
          abierto={registrar}
          onCambio={setRegistrar}
        />
      )}
      {usar && <DialogoUsarPaquete clinicId={clinicId} abierto={usar} onCambio={setUsar} />}
      {lectura && (
        <DialogoLecturaCiclo
          clinicId={clinicId}
          ciclo={lectura}
          onCerrar={() => setLectura(null)}
        />
      )}
      {etiquetar && (
        <DialogoEtiquetar
          clinicId={clinicId}
          ciclo={etiquetar}
          zona={zona}
          onCerrar={() => setEtiquetar(null)}
          onCreados={() => setFiltro("disponibles")}
        />
      )}
      {baja && (
        <DialogoBajaPaquete clinicId={clinicId} paquete={baja} onCerrar={() => setBaja(null)} />
      )}
    </AppShell>
  );
}
