import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Calendar } from "@/components/ui/calendar";
import { HolidayNotice } from "@/components/holiday-notice";
import { MisDatosYDerechos } from "@/components/portal/mis-datos-y-derechos";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePublicHolidays } from "@/hooks/use-public-holidays";
import {
  fechaAISO,
  formatoFechaLarga,
  hoyISO,
  parseIsoDate,
} from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { COUNTRIES } from "@/lib/onboarding-types";
import {
  getExpiredPortalContact,
  getMyPortalOverview,
  requestPortalAppointment,
} from "@/lib/patients/portal.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * El portal no tiene sesión de Supabase (sin `access.clinic?.timezone`
 * disponible) — `getMyPortalOverview` sí devuelve `clinic.country`, del que
 * derivamos la timezone real reusando el mapeo ya existente de `COUNTRIES`
 * (mismo que usa el onboarding). Sin `country` todavía (mientras `overview`
 * carga), cae al default de Chile de `hoyISO()` — igual que antes, pero
 * ahora se corrige solo apenas la clínica real carga (ver useEffect abajo).
 */
function timezoneFromCountry(country: string | undefined): string | undefined {
  return COUNTRIES.find((c) => c.code === country)?.timezone;
}

export const Route = createFileRoute("/portal/inicio")({
  head: () => ({
    meta: [{ title: "Mi clínica · Portal Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: PortalInicio,
});

function PortalInicio() {
  const fetchOverview = useServerFn(getMyPortalOverview);
  const requestFn = useServerFn(requestPortalAppointment);
  const fetchContact = useServerFn(getExpiredPortalContact);
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["portal-overview"],
    queryFn: () => fetchOverview({}),
    retry: false,
  });

  // Mismo criterio que /portal/$token: si la sesión venció, intenta traer el
  // WhatsApp real de la clínica (lee la cookie del token, que sigue en el
  // navegador aunque haya expirado) en vez de dejar al paciente con un
  // "contactá a tu clínica" sin ningún dato (auditoría UX, 30-ago).
  const [contact, setContact] = useState<{ clinicName: string; waUrl: string | null } | null>(null);
  useEffect(() => {
    if (!overview.isError) return;
    let cancelled = false;
    void fetchContact({ data: {} })
      .then((c) => !cancelled && setContact(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [overview.isError, fetchContact]);

  // Sin country todavía (primer render, overview sin cargar) cae al default
  // de Chile de hoyISO() — se corrige solo en el efecto de abajo apenas la
  // clínica real carga, sin pisar una fecha que el paciente ya haya elegido.
  const [preferredDate, setPreferredDate] = useState(hoyISO());
  const [preferredDateTouched, setPreferredDateTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"baja" | "media" | "alta">("media");
  const [enviado, setEnviado] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const clinicTimezone = timezoneFromCountry(overview.data?.clinic.country);

  useEffect(() => {
    if (preferredDateTouched || !clinicTimezone) return;
    setPreferredDate(hoyISO(clinicTimezone));
  }, [clinicTimezone, preferredDateTouched]);

  // Feriados (Nager.Date) del país de la clínica, para marcar el calendario
  // de "Pedir una hora". Cubre el año de la fecha elegida + el siguiente,
  // por si el paciente navega el calendario cerca de un cambio de año.
  const preferredYear = Number(preferredDate.slice(0, 4)) || new Date().getFullYear();
  const holidayYears = useMemo(() => [preferredYear, preferredYear + 1], [preferredYear]);
  const { holidaysByDate } = usePublicHolidays(overview.data?.clinic.country, holidayYears);
  const holidayDates = useMemo(
    () =>
      [...holidaysByDate.keys()].map((d) => parseIsoDate(d)).filter((d): d is Date => d !== null),
    [holidaysByDate],
  );
  const feriadoSeleccionado = holidaysByDate.get(preferredDate) ?? null;

  const requestMut = useMutation({
    mutationFn: () => requestFn({ data: { preferredDate, reason, priority } }),
    onSuccess: () => {
      setEnviado(true);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["portal-overview"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (overview.isError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Tu enlace del portal venció o no es válido. Contacta a tu clínica para que te envíe uno
          nuevo.
        </p>
        {contact?.waUrl && (
          <a
            href={contact.waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-medium text-brand-foreground"
          >
            <MessageCircle className="size-4" />
            Escribir a {contact.clinicName} por WhatsApp
          </a>
        )}
      </div>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <div className="mx-auto flex max-w-md items-center justify-center p-6">
        <Loader2 className="size-5 animate-spin text-brand" />
      </div>
    );
  }

  const { patient, appointments, plans } = overview.data;

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <section>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Hola, {patient.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Este es tu portal. Puedes ver tus próximas citas y pedir hora.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Próximas citas</h2>
        {appointments.length === 0 && (
          <p className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            No tienes citas agendadas.
          </p>
        )}
        {appointments.map((a) => (
          <article key={a.id} className="rounded-xl border border-border/60 bg-card p-4">
            <p className="truncate text-sm font-semibold">{a.treatment_label ?? "Consulta"}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" /> {formatoFechaLarga(a.starts_at.slice(0, 10))}
            </p>
          </article>
        ))}
      </section>

      {plans.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Tus tratamientos</h2>
          {plans.map((p) => (
            <article key={p.id} className="rounded-xl border border-border/60 bg-card p-4">
              <p className="truncate text-sm font-semibold">{p.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(p.total_cents, p.currency)}
              </p>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">Pedir una hora</h2>
        </div>
        {enviado ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className="size-8 text-brand" />
            <p className="text-sm font-medium">Solicitud enviada</p>
            <p className="text-xs text-muted-foreground">
              La clínica te va a contactar para confirmarte la hora.
            </p>
            <button
              type="button"
              onClick={() => setEnviado(false)}
              className="mt-2 text-xs text-brand-700 underline"
            >
              Pedir otra
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Día preferido</label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-transparent px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                  >
                    <span className="capitalize">{formatoFechaLarga(preferredDate)}</span>
                    <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseIsoDate(preferredDate) ?? undefined}
                    defaultMonth={parseIsoDate(preferredDate) ?? undefined}
                    onSelect={(date) => {
                      if (!date) return;
                      setPreferredDate(fechaAISO(date));
                      setPreferredDateTouched(true);
                      setCalendarOpen(false);
                    }}
                    disabled={{ before: parseIsoDate(hoyISO(clinicTimezone)) ?? new Date() }}
                    modifiers={{ feriado: holidayDates }}
                    modifiersClassNames={{
                      feriado: "bg-warning-soft text-warning font-semibold",
                    }}
                  />
                </PopoverContent>
              </Popover>
              {feriadoSeleccionado && <HolidayNotice name={feriadoSeleccionado} />}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Motivo</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Por ejemplo: dolor en la muela superior derecha…"
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Urgencia</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                className="w-full rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="baja">Baja — puedo esperar</option>
                <option value="media">Media — esta semana</option>
                <option value="alta">Alta — dolor / urgencia</option>
              </select>
            </div>
            <button
              type="button"
              disabled={!reason.trim() || requestMut.isPending}
              onClick={() => requestMut.mutate()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-transparent px-4 py-3 text-sm font-medium text-brand-700 disabled:opacity-50"
            >
              {requestMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar solicitud
            </button>
          </>
        )}
      </section>

      <MisDatosYDerechos />
    </div>
  );
}
