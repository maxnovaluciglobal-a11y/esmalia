import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Pause, Pencil, Play, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { INPUT } from "@/components/finanzas/piezas";
import { MoneyInput } from "@/components/money-input";
import {
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
  TINTA,
  TITULO_PANEL,
  TablaAPlus,
  TintaCargando,
  celda,
} from "@/components/reportes/aplus";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
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
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import {
  ETIQUETA_TIPO_DESCUENTO,
  TIPOS_DESCUENTO,
  describirDescuento,
  resumirEstadoDeCuenta,
  validarEmpresa,
  type EmpresaConvenio,
  type TipoDescuento,
} from "@/lib/finance/empresas-convenio";
import {
  getEstadoDeCuentaEmpresa,
  listEmpresasConvenio,
  saveEmpresaConvenio,
  setEmpresaConvenioActiva,
} from "@/lib/finance/empresas-convenio.functions";
import { montoPlanilla, siNoPlanilla } from "@/lib/exportacion/listas-csv";
import { numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_clinic/empresas-con-convenio")({
  beforeLoad: requirePermission("finance:view"),
  head: () => ({
    meta: [
      { title: "Empresas con convenio | Esmalia" },
      {
        name: "description",
        content:
          "Empresas que dan descuento a sus trabajadores y pagan por planilla, con el estado de cuenta de cada una.",
      },
    ],
  }),
  component: EmpresasPage,
});

function EmpresasPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const tz = access.clinic?.timezone;
  const currency = access.clinic?.currency ?? "CLP";
  const hoy = hoyISO(tz);

  const fetchSub = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSub({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60_000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchEmpresas = useServerFn(listEmpresasConvenio);
  const consulta = useQuery({
    queryKey: ["empresas-convenio", clinicId],
    queryFn: () => fetchEmpresas({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !bloqueado,
  });
  const empresas = consulta.data ?? [];
  const activas = empresas.filter((e) => e.active);
  const afiliados = empresas.reduce((s, e) => s + e.affiliates, 0);

  const [editando, setEditando] = useState<EmpresaConvenio | "nueva" | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const elegida = empresas.find((e) => e.id === seleccion) ?? activas[0] ?? null;

  return (
    <AppShell title="Empresas con convenio" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Empresas con convenio" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <EncabezadoEditorial
            seccion="Precios y cobro"
            pagina="Empresas con convenio"
            titulo={
              <>
                Empresas con <Destacado>convenio</Destacado>
              </>
            }
            conclusion={
              consulta.data
                ? empresas.length === 0
                  ? "Agrega las empresas que dan descuento a sus trabajadores. Los seguros e isapres siguen en Convenios."
                  : `${numero(activas.length)} ${activas.length === 1 ? "empresa activa" : "empresas activas"} con ${numero(afiliados)} ${afiliados === 1 ? "paciente afiliado" : "pacientes afiliados"}. El paciente se afilia desde su ficha.`
                : undefined
            }
            acciones={
              <>
                {clinicId && (
                  <ExportarCsvLista
                    clinicId={clinicId}
                    rol={access.role}
                    lista="empresas_convenio"
                    timezone={tz ?? "America/Santiago"}
                    filas={empresas}
                    columnas={[
                      { header: "Empresa", value: (e) => e.name },
                      { header: "RUT", value: (e) => e.taxId },
                      { header: "Contacto", value: (e) => e.contactName },
                      { header: "Correo", value: (e) => e.contactEmail },
                      { header: "Teléfono", value: (e) => e.contactPhone },
                      { header: "Descuento", value: (e) => describirDescuento(e) },
                      {
                        header: "Monto de descuento",
                        value: (e) => montoPlanilla(e.discountCents, e.currency),
                        dinero: true,
                      },
                      { header: "Por planilla", value: (e) => siNoPlanilla(e.payrollDeduction) },
                      { header: "Afiliados", value: (e) => e.affiliates },
                      { header: "Activa", value: (e) => siNoPlanilla(e.active) },
                    ]}
                  />
                )}
                <Button size="sm" onClick={() => setEditando("nueva")}>
                  <Plus className="size-4" /> Agregar empresa
                </Button>
              </>
            }
          />

          {consulta.isError ? (
            <ErrorDeCarga
              mensaje="No pudimos cargar las empresas. Revisa la conexión."
              onReintentar={() => void consulta.refetch()}
              reintentando={consulta.isFetching}
            />
          ) : !consulta.data ? (
            <TintaCargando texto="Cargando las empresas…" />
          ) : empresas.length === 0 ? (
            <section className={PANEL}>
              <SinDatos
                titulo="Sin empresas con convenio todavía."
                detalle="Ejemplo: una constructora cuyos trabajadores tienen 15 % de descuento y pagan por planilla."
                accion={
                  <Button size="sm" variant="outline" onClick={() => setEditando("nueva")}>
                    <Plus className="size-4" /> Agregar la primera
                  </Button>
                }
              />
            </section>
          ) : (
            <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <section aria-labelledby="emp-lista" className={cn(PANEL, "p-0")}>
                <h2 id="emp-lista" className={cn(TITULO_PANEL, "px-5 pt-5")}>
                  <Destacado>Empresas</Destacado>
                </h2>
                <ul className="mt-3 divide-y divide-hairline">
                  {empresas.map((e) => (
                    <FilaEmpresa
                      key={e.id}
                      empresa={e}
                      clinicId={clinicId!}
                      elegida={elegida?.id === e.id}
                      onElegir={() => setSeleccion(e.id)}
                      onEditar={() => setEditando(e)}
                    />
                  ))}
                </ul>
              </section>
              {elegida && (
                <EstadoDeCuenta
                  key={elegida.id}
                  clinicId={clinicId!}
                  empresa={elegida}
                  currency={currency}
                  hoy={hoy}
                />
              )}
            </div>
          )}
        </div>
      )}
      {editando && clinicId && (
        <DialogoEmpresa
          clinicId={clinicId}
          currency={currency}
          empresa={editando === "nueva" ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}
    </AppShell>
  );
}

function FilaEmpresa({
  empresa,
  clinicId,
  elegida,
  onElegir,
  onEditar,
}: {
  empresa: EmpresaConvenio;
  clinicId: string;
  elegida: boolean;
  onElegir: () => void;
  onEditar: () => void;
}) {
  const qc = useQueryClient();
  const fn = useServerFn(setEmpresaConvenioActiva);
  const activar = useMutation({
    mutationFn: () => fn({ data: { clinicId, id: empresa.id, active: !empresa.active } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empresas-convenio", clinicId] });
      toast.success(empresa.active ? "Empresa desactivada" : "Empresa activada");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <li className={cn("flex items-center gap-2 px-3 py-2", elegida && "bg-muted/50")}>
      <button
        type="button"
        onClick={onElegir}
        aria-pressed={elegida}
        className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          className={cn(
            "block truncate text-[15px] font-semibold",
            !empresa.active && "text-muted-foreground",
          )}
        >
          {empresa.name}
        </span>
        <span className="block text-[13px] text-muted-foreground">
          {describirDescuento(empresa)}
          {empresa.payrollDeduction ? " · por planilla" : ""} · {numero(empresa.affiliates)}{" "}
          {empresa.affiliates === 1 ? "afiliado" : "afiliados"}
          {!empresa.active && " · desactivada"}
        </span>
      </button>
      <Button variant="ghost" size="sm" onClick={onEditar} aria-label={`Editar ${empresa.name}`}>
        <Pencil className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => activar.mutate()}
        disabled={activar.isPending}
        aria-label={empresa.active ? `Desactivar ${empresa.name}` : `Activar ${empresa.name}`}
      >
        {empresa.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
    </li>
  );
}

function EstadoDeCuenta({
  clinicId,
  empresa,
  currency,
  hoy,
}: {
  clinicId: string;
  empresa: EmpresaConvenio;
  currency: string;
  hoy: string;
}) {
  const [rango, setRango] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  const fn = useServerFn(getEstadoDeCuentaEmpresa);
  const consulta = useQuery({
    queryKey: ["estado-cuenta-empresa", clinicId, empresa.id, rango.desde, rango.hasta],
    queryFn: () => fn({ data: { clinicId, companyId: empresa.id, ...rango } }),
  });
  const filas = consulta.data ?? [];
  const r = resumirEstadoDeCuenta(filas, empresa.payrollDeduction);
  const dinero = (c: number) => formatMoney(c, currency);

  return (
    <section aria-labelledby="emp-estado" className="min-w-0 space-y-[18px]">
      <div className={cn(TINTA, "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <EtiquetaTinta>
              {empresa.payrollDeduction ? "A descontar por planilla" : "Saldo de los afiliados"}
            </EtiquetaTinta>
            <MontoEnTinta cents={r.saldoCents} currency={currency} />
          </div>
          <Building2 className="size-6 text-on-night-2" aria-hidden />
        </div>
        <p id="emp-estado" className="text-sm font-medium text-on-night-2">
          Estado de cuenta de <b className="font-semibold text-on-night">{empresa.name}</b>
          {empresa.payrollDeduction
            ? ": la empresa le paga a la clínica y lo descuenta del sueldo."
            : ": sin descuento por planilla, cada afiliado paga lo suyo."}
        </p>
        <DatosEnTinta
          columnas={3}
          datos={[
            { label: "Afiliados", valor: numero(r.afiliados), nota: `${numero(r.conMovimiento)} con movimiento` },
            { label: "Realizado en el período", valor: dinero(r.realizadoCents), nota: "parte del paciente" },
            { label: "Pagado en el período", valor: dinero(r.pagadoCents) },
          ]}
        />
      </div>

      <div className={cn(PANEL, "p-0")}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h3 className={TITULO_PANEL}>
            <Destacado>Afiliados</Destacado>
          </h3>
          <SelectorPeriodo
            desde={rango.desde}
            hasta={rango.hasta}
            hoy={hoy}
            onCambiar={(x) => setRango((r) => ({ ...r, ...x }))}
          />
        </div>
        {consulta.isError ? (
          <ErrorDeCarga
            className="m-5"
            mensaje="No pudimos armar el estado de cuenta."
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          />
        ) : !consulta.data ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Cargando…</p>
        ) : filas.length === 0 ? (
          <SinDatos
            titulo="Esta empresa todavía no tiene pacientes afiliados."
            detalle="Afilia a un paciente desde su ficha, en el bloque Empresa y membresía."
          />
        ) : (
          <div className="mt-3">
            <TablaAPlus
              minAncho="34rem"
              columnas={[
                { label: "Paciente" },
                { label: "Realizado", derecha: true },
                { label: "Pagado", derecha: true },
                { label: "Saldo hoy", derecha: true },
              ]}
            >
              {filas.map((f) => (
                <tr key={f.patientId} className={FILA}>
                  <td className={celda(0, 4)}>
                    <span className="font-medium">{f.fullName}</span>
                    {f.employeeCode && (
                      <span className="block text-xs text-muted-foreground">
                        Código {f.employeeCode}
                      </span>
                    )}
                  </td>
                  <td className={celda(1, 4, "cifra text-right")}>{dinero(f.realizadoCents)}</td>
                  <td className={celda(2, 4, "cifra text-right")}>{dinero(f.pagadoCents)}</td>
                  <td className={celda(3, 4, "cifra text-right")}>
                    {f.saldoCents > 0 ? (
                      dinero(f.saldoCents)
                    ) : (
                      <Pastilla tono="success" icono={Receipt}>
                        Al día
                      </Pastilla>
                    )}
                  </td>
                </tr>
              ))}
            </TablaAPlus>
          </div>
        )}
      </div>
    </section>
  );
}

function DialogoEmpresa({
  clinicId,
  currency,
  empresa,
  onCerrar,
}: {
  clinicId: string;
  currency: string;
  empresa: EmpresaConvenio | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    name: empresa?.name ?? "",
    taxId: empresa?.taxId ?? "",
    contactName: empresa?.contactName ?? "",
    contactEmail: empresa?.contactEmail ?? "",
    contactPhone: empresa?.contactPhone ?? "",
    discountKind: (empresa?.discountKind ?? "percent") as TipoDescuento,
    discountPercent: empresa?.discountPercent ?? (10 as number | null),
    discountCents: empresa?.discountCents ?? (null as number | null),
    payrollDeduction: empresa?.payrollDeduction ?? true,
    notes: empresa?.notes ?? "",
  });
  const patch = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const errores = validarEmpresa({
    name: d.name,
    discountKind: d.discountKind,
    discountPercent: d.discountPercent,
    discountCents: d.discountCents,
    contactEmail: d.contactEmail || null,
  });
  const fn = useServerFn(saveEmpresaConvenio);
  const guardar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          clinicId,
          ...(empresa ? { id: empresa.id } : {}),
          name: d.name,
          taxId: d.taxId.trim() || null,
          contactName: d.contactName.trim() || null,
          contactEmail: d.contactEmail.trim() || null,
          contactPhone: d.contactPhone.trim() || null,
          discountKind: d.discountKind,
          discountPercent: d.discountKind === "percent" ? d.discountPercent : null,
          discountCents: d.discountKind === "amount" ? d.discountCents : null,
          payrollDeduction: d.payrollDeduction,
          notes: d.notes.trim() || null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empresas-convenio", clinicId] });
      toast.success(empresa ? "Empresa actualizada" : "Empresa agregada");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{empresa ? "Editar empresa" : "Agregar empresa con convenio"}</DialogTitle>
          <DialogDescription>
            El descuento se muestra en la ficha de cada afiliado. Con descuento por planilla, la
            empresa le paga a la clínica lo de sus trabajadores.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="emp-nombre">Nombre *</Label>
              <input
                id="emp-nombre"
                value={d.name}
                onChange={(e) => patch({ name: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-rut">RUT</Label>
              <input
                id="emp-rut"
                value={d.taxId}
                onChange={(e) => patch({ taxId: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-tipo">Descuento</Label>
              <select
                id="emp-tipo"
                value={d.discountKind}
                onChange={(e) => patch({ discountKind: e.target.value as TipoDescuento })}
                className={INPUT}
              >
                {TIPOS_DESCUENTO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_DESCUENTO[t]}
                  </option>
                ))}
              </select>
            </div>
            {d.discountKind === "percent" && (
              <div className="space-y-1.5">
                <Label htmlFor="emp-pct">Porcentaje</Label>
                <input
                  id="emp-pct"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={d.discountPercent ?? ""}
                  onChange={(e) =>
                    patch({ discountPercent: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className={INPUT}
                />
              </div>
            )}
            {d.discountKind === "amount" && (
              <div className="space-y-1.5">
                <Label htmlFor="emp-monto">Monto por atención</Label>
                <MoneyInput
                  id="emp-monto"
                  currency={currency}
                  min={0}
                  valueCents={d.discountCents}
                  onValueChange={(v) => patch({ discountCents: v })}
                />
              </div>
            )}
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={d.payrollDeduction}
              onChange={(e) => patch({ payrollDeduction: e.target.checked })}
            />
            <span>
              <b className="font-semibold">Descuento por planilla.</b> La empresa paga a la clínica
              y lo descuenta del sueldo del trabajador.
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="emp-contacto">Contacto</Label>
              <input
                id="emp-contacto"
                value={d.contactName}
                onChange={(e) => patch({ contactName: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-correo">Correo</Label>
              <input
                id="emp-correo"
                type="email"
                value={d.contactEmail}
                onChange={(e) => patch({ contactEmail: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-tel">Teléfono</Label>
              <input
                id="emp-tel"
                value={d.contactPhone}
                onChange={(e) => patch({ contactPhone: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-notas">Notas</Label>
            <textarea
              id="emp-notas"
              rows={2}
              value={d.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Día de corte de la planilla, a quién mandar el estado de cuenta"
              className={INPUT}
            />
          </div>
        </div>
        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {errores.length > 0 && (
            <p id="emp-motivo" className="text-xs text-muted-foreground">
              {errores[0]}
            </p>
          )}
          <Button
            onClick={() => guardar.mutate()}
            disabled={errores.length > 0 || guardar.isPending}
            aria-describedby={errores.length > 0 ? "emp-motivo" : undefined}
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
