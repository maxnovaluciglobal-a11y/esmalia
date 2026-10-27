import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, CircleDashed, Eye, Loader2, Lock, UserRound } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraApilada,
  BarraFina,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  FILA,
  MontoEnTinta,
  PANEL,
  Pastilla,
  SelectorPeriodo,
  SinDatos,
  TablaAPlus,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
  celda,
  type ColumnaTabla,
} from "@/components/reportes/aplus";
import { ReglasDeComisionPanel } from "@/components/finance/comisiones-reglas";
import { LiquidacionCerradaDialog } from "@/components/finance/liquidacion-detalle";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Button } from "@/components/ui/button";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { requireAnyPermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { formatMoney } from "@/lib/finance/finance";
import { nombreDelPeriodo } from "@/lib/finance/periodos-reporte";
import { fecha, numero } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";
import {
  closeCommissionPeriod,
  getCommissionReport,
  markCommissionSettlementPaid,
} from "@/lib/finance/commissions.functions";
import { str } from "@/lib/search";
import { mensajeDeError } from "@/lib/mensaje-error";

interface ComisionesSearch {
  desde: string;
  hasta: string;
}

// validateSearch corre antes del componente (sin Route.useRouteContext(),
// mismo problema estructural que ya documenta agenda.tsx:HOY) — impacto
// acotado al rango por defecto del reporte mientras la URL no traiga fecha
// explícita. Dentro del componente (onReset más abajo) sí usamos
// access.clinic?.timezone real.
function primerDiaDelMes(timeZone?: string): string {
  const hoy = hoyISO(timeZone);
  return `${hoy.slice(0, 7)}-01`;
}

export const Route = createFileRoute("/_authenticated/_clinic/comisiones")({
  validateSearch: (search: Record<string, unknown>): ComisionesSearch => ({
    desde: str(search.desde, primerDiaDelMes()),
    hasta: str(search.hasta, hoyISO()),
  }),
  // ux-3 auditoría 360 v2: finance:view ve a todo el equipo; commission:view-own
  // deja pasar a un dentist a ver SOLO su propia liquidación (el componente
  // decide qué renderiza según cuál de los dos permisos tiene el rol).
  beforeLoad: requireAnyPermission("finance:view", "commission:view-own"),
  head: () => ({
    meta: [
      { title: "Comisiones | Esmalia" },
      {
        name: "description",
        content:
          "Liquidación de comisiones por profesional según producción realizada en el período.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ComisionesPage,
});

function ComisionesPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";

  // Ve todo el equipo (owner/admin/accounting) vs. solo su propia línea
  // (dentist con commission:view-own, sin finance:view).
  const veTodo = hasPermission(access.role, "finance:view");
  const puedeGestionar = access.role === "owner" || access.role === "admin";
  const soloMiProfessionalId = !veTodo ? (access.myProfessionalId ?? undefined) : undefined;

  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  // ONB-07: marcar pagada una liquidación se confirma con el monto.
  const [aPagar, setAPagar] = useState<{ id: string; nombre: string; cents: number | null } | null>(
    null,
  );

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchReport = useServerFn(getCommissionReport);
  const closePeriod = useServerFn(closeCommissionPeriod);
  const markPaid = useServerFn(markCommissionSettlementPaid);

  // veTodo entra en la key: sin esto, un dentist sin professionalId resuelto
  // (soloMiProfessionalId undefined, igual que el caso "veo todo") reusaría
  // el cache de la vista completa y vería momentáneamente las líneas de sus
  // colegas hasta el próximo refetch.
  const queryKey = [
    "commission-report",
    clinicId,
    search.desde,
    search.hasta,
    veTodo,
    soloMiProfessionalId ?? null,
  ];

  const {
    data: lineas,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    enabled: Boolean(clinicId) && !bloqueado && (veTodo || Boolean(soloMiProfessionalId)),
    queryFn: () =>
      fetchReport({
        data: {
          clinicId: clinicId!,
          from: search.desde,
          to: search.hasta,
          professionalId: soloMiProfessionalId,
        },
      }),
  });

  const cerrarPeriodo = useMutation({
    mutationFn: () =>
      closePeriod({ data: { clinicId: clinicId!, from: search.desde, to: search.hasta } }),
    onSuccess: (res) => {
      toast.success(
        res.closed > 0
          ? `Período cerrado para ${res.closed} profesional${res.closed === 1 ? "" : "es"}.`
          : "No había nada nuevo para cerrar en este período.",
      );
      setConfirmarCierre(false);
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const marcarPagado = useMutation({
    mutationFn: (settlementId: string) => markPaid({ data: { clinicId: clinicId!, settlementId } }),
    onSuccess: () => {
      setAPagar(null);
      toast.success("Liquidación marcada como pagada.");
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const set = (patch: Partial<ComisionesSearch>) =>
    navigate({ search: (prev: ComisionesSearch) => ({ ...prev, ...patch }) });

  const totalComision = (lineas ?? []).reduce((acc, l) => acc + (l.commissionCents ?? 0), 0);
  const totalProduccion = (lineas ?? []).reduce((acc, l) => acc + l.productionCents, 0);
  const sinRegla = (lineas ?? []).filter((l) => l.commissionCents === null).length;

  const lineasVisibles = lineas ?? [];
  const totalProcedimientos = lineasVisibles.reduce((acc, l) => acc + l.procedureCount, 0);
  const pagadas = lineasVisibles.filter((l) => l.closed && l.paidAt).length;
  const cerradas = lineasVisibles.filter((l) => l.closed && !l.paidAt).length;
  const abiertas = lineasVisibles.filter((l) => !l.closed).length;
  const porCerrar = lineasVisibles.filter((l) => !l.closed && l.commissionCents !== null);
  const totalPorCerrar = porCerrar.reduce((acc, l) => acc + (l.commissionCents ?? 0), 0);
  const maxComision = Math.max(
    0,
    ...lineasVisibles.map((l) => l.commissionCents ?? l.productionCents),
  );
  const hoy = hoyISO(access.clinic?.timezone);
  const periodo = nombreDelPeriodo(search.desde, search.hasta, hoy);
  const dinero = (c: number) => formatMoney(c, currency);
  const conAcciones = veTodo && puedeGestionar;
  const columnas: ColumnaTabla[] = [
    { label: "Profesional" },
    { label: "Regla", className: "hidden lg:table-cell" },
    { label: "Estado" },
    { label: "Proced.", derecha: true, className: "hidden md:table-cell" },
    { label: "Producción", derecha: true, className: "hidden sm:table-cell" },
    { label: "Comisión", derecha: true },
    { label: "", className: "w-0" },
  ];
  const n = columnas.length;

  const conclusion = !lineas ? undefined : lineasVisibles.length === 0 ? (
    veTodo ? (
      "No hay profesionales cargados."
    ) : (
      "No hay producción registrada a tu nombre en este período."
    )
  ) : (
    <>
      <b className="font-semibold text-foreground">
        {veTodo ? "Comisión total" : "Tu comisión"}: {dinero(totalComision)}
      </b>{" "}
      sobre {dinero(totalProduccion)} de producción realizada.
      {veTodo && sinRegla > 0 && (
        <>
          {" "}
          {sinRegla === 1
            ? "Un profesional no tiene regla configurada y no se le calcula nada."
            : `${sinRegla} profesionales no tienen regla configurada y no se les calcula nada.`}
        </>
      )}
    </>
  );

  return (
    <AppShell title="Comisiones" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Comisiones" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="space-y-4 pb-2">
            <EncabezadoEditorial
              seccion="Reportes"
              pagina="Comisiones"
              titulo={
                <>
                  {veTodo ? "Comisiones de " : "Mi comisión de "}
                  <Destacado>{periodo}</Destacado>
                </>
              }
              conclusion={conclusion}
              acciones={
                <>
                  <Link
                    to="/mi-desempeno"
                    search={{ desde: search.desde, hasta: search.hasta }}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:border-foreground"
                  >
                    <UserRound aria-hidden className="size-4" />
                    {veTodo ? "Desempeño por profesional" : "Mi desempeño"}
                  </Link>
                  {conAcciones && (
                    <Button
                      variant="outline"
                      className="h-10 rounded-full px-4"
                      onClick={() => setConfirmarCierre(true)}
                      disabled={!clinicId || isLoading || lineasVisibles.length === 0}
                    >
                      <Lock aria-hidden />
                      Cerrar período
                    </Button>
                  )}
                </>
              }
            />
            <SelectorPeriodo
              desde={search.desde}
              hasta={search.hasta}
              hoy={hoy}
              onCambiar={(r) => set(r)}
            />
          </div>

          {!isLoading && !veTodo && !soloMiProfessionalId && (
            <p className="rounded-[14px] border border-dashed border-warning-border bg-warning-soft px-5 py-4 text-sm text-foreground/85">
              Todavía no hay una ficha de profesional vinculada a tu cuenta en esta clínica, así que
              no podemos mostrarte tu comisión. Pide a un administrador que revise tu perfil en
              Profesionales.
            </p>
          )}

          {isError && (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar las comisiones." />
          )}

          {isLoading && <TintaCargando texto="Calculando las comisiones…" />}

          {!isLoading && lineas && (
            <>
              <section
                aria-label="Resumen de comisiones"
                className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}
              >
                <div className="min-w-0">
                  <EtiquetaTinta>
                    {veTodo ? "Comisión del período" : "Mi comisión del período"}
                  </EtiquetaTinta>
                  <MontoEnTinta cents={totalComision} currency={currency} />
                  <p className="mt-3.5 text-sm font-medium text-on-night-2">
                    sobre <b className="font-semibold text-on-night">{dinero(totalProduccion)}</b>{" "}
                    de producción {veTodo ? "total" : "tuya"}
                  </p>
                  <div className="mt-6">
                    <DatosEnTinta
                      columnas={3}
                      datos={[
                        {
                          label: "Procedimientos",
                          valor: numero(totalProcedimientos),
                          nota: "completados",
                        },
                        {
                          label: "Profesionales",
                          valor: numero(lineasVisibles.length),
                          nota: veTodo ? "con línea en el período" : undefined,
                        },
                        {
                          label: "Sin regla",
                          valor: veTodo ? numero(sinRegla) : sinRegla > 0 ? "Sí" : "No",
                          nota: sinRegla > 0 ? "se edita en Profesionales" : "todos con regla",
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <EtiquetaTinta>Estado de la liquidación</EtiquetaTinta>
                  <BarraApilada
                    sobre="tinta"
                    sinPorcentaje
                    vacio="Sin líneas en este período."
                    partes={[
                      {
                        clave: "abierto",
                        etiqueta: "Abierto · se recalcula con la regla vigente",
                        valor: abiertas,
                        texto: numero(abiertas),
                      },
                      {
                        clave: "cerrado",
                        etiqueta: "Cerrado · monto congelado, por pagar",
                        valor: cerradas,
                        texto: numero(cerradas),
                      },
                      {
                        clave: "pagado",
                        etiqueta: "Pagado",
                        valor: pagadas,
                        texto: numero(pagadas),
                      },
                    ]}
                  />
                </div>
              </section>

              <section aria-labelledby="com-lista" className={cn(PANEL, "overflow-hidden")}>
                <div className="px-5 pt-[18px] pb-3">
                  <h2 id="com-lista" className={TITULO_PANEL}>
                    Por <Destacado>profesional</Destacado>
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {veTodo
                      ? "Con la regla que regía en cada fecha, sobre lo realizado o lo cobrado según cada profesional. Un período cerrado conserva su monto y su detalle."
                      : "Con la regla que configuró la clínica para cada fecha, sobre lo realizado o lo cobrado."}
                  </p>
                </div>
                {lineasVisibles.length === 0 ? (
                  <SinDatos
                    className="border-t border-hairline"
                    titulo={
                      veTodo
                        ? "No hay profesionales cargados."
                        : "No hay producción registrada a tu nombre en este período."
                    }
                  />
                ) : (
                  <TablaAPlus columnas={columnas}>
                    {lineasVisibles.map((l) => {
                      const valorBarra = l.commissionCents ?? l.productionCents;
                      return (
                        <tr key={l.professionalId} className={FILA}>
                          <td className={celda(0, n, "min-w-[9rem]")}>
                            <span className="font-medium">{l.professionalName}</span>
                            <BarraFina
                              className="mt-1.5 max-w-[14rem]"
                              pct={maxComision > 0 ? (valorBarra / maxComision) * 100 : 0}
                              color={colorProfesional(l.color)}
                            />
                            <span className="mt-1 block text-[12.5px] text-muted-foreground lg:hidden">
                              {l.ruleLabel}
                            </span>
                          </td>
                          <td
                            className={celda(
                              1,
                              n,
                              "hidden text-[13px] text-muted-foreground lg:table-cell",
                            )}
                          >
                            {l.ruleLabel}
                          </td>
                          <td className={celda(2, n)}>
                            {l.closed && l.paidAt ? (
                              <Pastilla tono="success" icono={CheckCheck}>
                                Pagado
                              </Pastilla>
                            ) : l.closed ? (
                              <Pastilla tono="info" icono={Lock}>
                                Cerrado
                              </Pastilla>
                            ) : (
                              <Pastilla tono="neutral" icono={CircleDashed}>
                                Abierto
                              </Pastilla>
                            )}
                          </td>
                          <td className={celda(3, n, "cifra hidden text-right md:table-cell")}>
                            {numero(l.procedureCount)}
                          </td>
                          <td
                            className={celda(
                              4,
                              n,
                              "cifra hidden text-right whitespace-nowrap sm:table-cell",
                            )}
                          >
                            {dinero(l.productionCents)}
                          </td>
                          <td
                            className={celda(
                              5,
                              n,
                              "cifra text-right font-semibold whitespace-nowrap",
                            )}
                          >
                            {l.commissionCents === null ? "—" : dinero(l.commissionCents)}
                          </td>
                          <td className={celda(6, n, "text-right whitespace-nowrap")}>
                            <span className="inline-flex gap-1.5">
                              {l.closed && l.settlementId && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-full"
                                  onClick={() => setDetalle(l.settlementId)}
                                  aria-label={`Ver la liquidación de ${l.professionalName}`}
                                >
                                  <Eye aria-hidden /> Detalle
                                </Button>
                              )}
                              {conAcciones && l.closed && !l.paidAt && l.settlementId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={marcarPagado.isPending}
                                  onClick={() =>
                                    setAPagar({
                                      id: l.settlementId!,
                                      nombre: l.professionalName,
                                      cents: l.commissionCents,
                                    })
                                  }
                                >
                                  {marcarPagado.isPending && (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  )}
                                  Marcar pagado
                                </Button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </TablaAPlus>
                )}
              </section>

              {puedeGestionar && veTodo && clinicId && (
                <ReglasDeComisionPanel clinicId={clinicId} />
              )}
            </>
          )}
        </div>
      )}

      {clinicId && (
        <LiquidacionCerradaDialog
          clinicId={clinicId}
          settlementId={detalle}
          currency={currency}
          onCerrar={() => setDetalle(null)}
        />
      )}

      <ConfirmarAccion
        abierto={confirmarCierre}
        onAbiertoChange={setConfirmarCierre}
        titulo="Cerrar período de comisiones"
        cifra={
          porCerrar.length > 0
            ? {
                etiqueta: `${porCerrar.length} profesional${porCerrar.length === 1 ? "" : "es"} por liquidar`,
                valor: formatMoney(totalPorCerrar, currency),
              }
            : null
        }
        consecuencias={[
          `Se congelan los montos del ${fecha(search.desde)} al ${fecha(search.hasta)} para cada profesional con regla en el período, con su detalle línea por línea.`,
          "Una liquidación cerrada no cambia: modificar una regla ya no la afecta y ninguna regla nueva puede regir desde una fecha liquidada.",
        ]}
        etiquetaAccion="Cerrar período"
        pendiente={cerrarPeriodo.isPending}
        onConfirmar={() => cerrarPeriodo.mutate()}
      />
      <ConfirmarAccion
        abierto={aPagar !== null}
        onAbiertoChange={(abierto) => !abierto && setAPagar(null)}
        titulo={aPagar ? `¿Marcar pagada la liquidación de ${aPagar.nombre}?` : ""}
        cifra={
          aPagar?.cents != null
            ? { etiqueta: "Comisión", valor: formatMoney(aPagar.cents, currency) }
            : null
        }
        consecuencias={[
          "Queda registrado que ya se le pagó, con la fecha de hoy.",
          "Esmalia no mueve dinero: solo deja la marca. El pago lo haces tú por fuera.",
        ]}
        etiquetaAccion="Marcar pagada"
        pendiente={marcarPagado.isPending}
        onConfirmar={() => aPagar && marcarPagado.mutate(aPagar.id)}
      />
    </AppShell>
  );
}
