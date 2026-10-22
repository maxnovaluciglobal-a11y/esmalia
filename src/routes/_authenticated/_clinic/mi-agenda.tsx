import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, CircleCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { PatientConfirmedBadge } from "@/components/patient-confirmed-badge";
import { requirePermission } from "@/lib/access/route-guards";
import { etiquetaEstado, formatoFechaLarga, hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  listAppointments,
  setAppointmentStatus,
} from "@/lib/clinic-operations/appointments.functions";
import { clasePastilla, tonoDeEstadoCita } from "@/lib/clinic-operations/estado-cita-tono";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/mi-agenda")({
  // Mismo permiso que /agenda — no es un rol nuevo, es una vista alternativa
  // más liviana, pensada para el celular, sobre los mismos datos.
  beforeLoad: requirePermission("agenda:view"),
  head: () => ({
    meta: [
      { title: "Mi agenda | Esmalia" },
      {
        name: "description",
        content: "Vista simplificada de agenda: citas de hoy y pendientes de aceptar.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MiAgendaPage,
});

function MiAgendaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const timeZone = access.clinic?.timezone;
  const hoy = hoyISO(timeZone);
  const queryClient = useQueryClient();

  const fetchAppointments = useServerFn(listAppointments);
  const {
    data: appointmentsRes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["appointments", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchAppointments({ data: { clinicId: clinicId! } }),
  });
  const citas = useMemo(() => appointmentsRes?.items ?? [], [appointmentsRes]);

  const esGestor = access.role === "owner" || access.role === "admin";
  const misCitas = useMemo(
    () =>
      citas.filter((c) =>
        esGestor
          ? true
          : Boolean(access.myProfessionalId) && c.profesionalId === access.myProfessionalId,
      ),
    [citas, esGestor, access.myProfessionalId],
  );

  const porAceptar = useMemo(
    () =>
      misCitas
        .filter((c) => c.estado === "tentativa")
        .sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + String(b.inicio))),
    [misCitas],
  );

  const hoyOrdenadas = useMemo(
    // listAppointments ya excluye canceladas — no hace falta filtrarlas acá.
    () => misCitas.filter((c) => c.fecha === hoy).sort((a, b) => a.inicio - b.inicio),
    [misCitas, hoy],
  );

  const setEstadoFn = useServerFn(setAppointmentStatus);
  const aceptar = useMutation({
    mutationFn: (appointmentId: string) =>
      setEstadoFn({ data: { appointmentId, estado: "confirmada" } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      toast.success("Cita confirmada");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const sinFichaPropia = !esGestor && !access.myProfessionalId;

  return (
    <AppShell title="Mi agenda" access={access}>
      <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
        {sinFichaPropia ? (
          <p className="rounded-2xl border border-hairline p-5 text-sm text-muted-foreground">
            Esta vista es para profesionales con agenda propia. Tu usuario no tiene una ficha de
            profesional vinculada — usa{" "}
            <Link
              to="/agenda"
              search={{
                q: "",
                fecha: hoy,
                sucursal: "",
                profesional: "",
                estado: "",
                page: 1,
              }}
              className="font-medium text-brand-700 underline"
            >
              la agenda general
            </Link>
            .
          </p>
        ) : isError ? (
          // Un error no es "no tienes citas": las dos secciones salen de la
          // misma consulta y antes se veían vacías.
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar tu agenda." />
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold text-warning">
                <CircleCheck className="size-4" /> Por aceptar
                {porAceptar.length > 0 && (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
                    {porAceptar.length}
                  </span>
                )}
              </h2>
              {porAceptar.length === 0 ? (
                <p className="rounded-2xl border border-hairline p-4 text-sm text-muted-foreground">
                  No tienes citas esperando aceptación.
                </p>
              ) : (
                <div className="space-y-2">
                  {porAceptar.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft/40 p-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.paciente}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.tratamiento} · {formatoFechaLarga(c.fecha)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => aceptar.mutate(c.id)}
                        disabled={aceptar.isPending}
                        className="shrink-0 rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-semibold text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-50"
                      >
                        {aceptar.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          "Aceptar"
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
                <CalendarCheck className="size-4" /> Hoy
              </h2>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : hoyOrdenadas.length === 0 ? (
                <p className="rounded-2xl border border-hairline p-4 text-sm text-muted-foreground">
                  No tienes citas hoy.
                </p>
              ) : (
                <div className="divide-y divide-hairline rounded-2xl border border-hairline">
                  {hoyOrdenadas.map((c) => (
                    <Link
                      key={c.id}
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: c.pacienteId }}
                      className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.paciente}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.tratamiento}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {c.pacienteConfirmo && <PatientConfirmedBadge />}
                        <EstadoCitaPastilla cita={{ estado: c.estado }} className="shrink-0" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
