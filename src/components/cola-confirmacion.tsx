import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, Clock, Phone } from "lucide-react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { setPatientConfirmation } from "@/lib/clinic-operations/appointments.functions";
import { formatoFechaLarga, type Cita } from "@/lib/clinic-operations/clinic-data";
import { listPatients } from "@/lib/patients/patients.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

function hora(inicio: number) {
  const t = 8 * 60 + inicio;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** En escritorio la columna derecha muestra hasta 5; el resto, en /recordatorios. */
const MAX_COMPACTA = 5;

/**
 * Cola de confirmación: citas de hoy y mañana sin aviso del paciente.
 * "Confirmó" anota `patient_confirmed_at` — el eje del PACIENTE, nunca el
 * estado del profesional (ver CLAUDE.md, webhook) — así que desde "Hoy"
 * queda a un toque.
 *
 * Dos variantes (dirección híbrida, 08-oct-2026):
 * - `compacta` (escritorio, columna derecha): filas de una línea y acciones
 *   de 36px (44px en pantallas táctiles).
 * - `aviso` (celular): un aviso de una línea ("3 citas por confirmar · Ver")
 *   que despliega la lista. Antes eran tarjetas de ~190px arriba de todo y
 *   la agenda quedaba fuera de la primera pantalla.
 */
export function ColaConfirmacion({
  clinicId,
  clinicaNombre,
  citas,
  hoy,
  nombreProfesional,
  variante = "compacta",
}: {
  clinicId: string;
  clinicaNombre: string;
  citas: Cita[];
  hoy: string;
  nombreProfesional: Map<string, string>;
  variante?: "compacta" | "aviso";
}) {
  const queryClient = useQueryClient();
  const marcar = useServerFn(setPatientConfirmation);
  const fetchPatients = useServerFn(listPatients);
  const [abierta, setAbierta] = useState(false);
  const idLista = useId();

  const pendientes = useMemo(() => {
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    const mananaISO = manana.toISOString().slice(0, 10);
    return citas
      .filter(
        (c) =>
          (c.fecha === hoy || c.fecha === mananaISO) &&
          c.estado === "tentativa" &&
          !c.pacienteConfirmo,
      )
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.inicio - b.inicio);
  }, [citas, hoy]);

  // Mismo queryKey que /pacientes: comparte caché. Solo para los teléfonos.
  const { data: telefonos } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: pendientes.length > 0,
    queryFn: () => fetchPatients({ data: { clinicId } }),
    select: (res) => new Map(res.items.map((p) => [p.id, p.telefono])),
  });

  const confirmar = useMutation({
    mutationFn: (appointmentId: string) =>
      marcar({ data: { appointmentId, confirmado: true, via: "telefono" } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      toast.success("Anotado: el paciente avisó que viene.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (pendientes.length === 0) return null;

  const n = pendientes.length;
  const deHoy = pendientes.filter((c) => c.fecha === hoy);
  const visibles = variante === "compacta" ? pendientes.slice(0, MAX_COMPACTA) : pendientes;
  const tactil = variante === "aviso";

  const lista = (
    <ul
      id={idLista}
      className={cn(
        "divide-y divide-hairline",
        variante === "compacta" ? "border-t border-hairline" : "border-y border-border",
      )}
    >
      {visibles.map((c) => {
        const tel = telefonos?.get(c.pacienteId) || null;
        const enviando = confirmar.isPending && confirmar.variables === c.id;
        const profesional = nombreProfesional.get(c.profesionalId) ?? "—";
        return (
          <li key={c.id} className={cn("space-y-2.5", tactil ? "py-3" : "px-5 py-3.5")}>
            <div className="flex items-start justify-between gap-3">
              <Link
                to="/pacientes/$pacienteId"
                params={{ pacienteId: c.pacienteId }}
                className="min-w-0 rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="block truncate font-display text-[19px] font-medium leading-tight">
                  {c.paciente}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {c.tratamiento} · {profesional}
                </span>
              </Link>
              <span className="shrink-0 text-right leading-none">
                <span className="cifra block text-[15px] font-medium">{hora(c.inicio)}</span>
                <span className="text-[11.5px] font-medium text-muted-foreground">
                  {c.fecha === hoy ? "Hoy" : "Mañana"}
                </span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {/* Mismo envío que /recordatorios: queda en `messages` con
                  appointment_id y template_kind, así la cola de
                  recordatorios lo da por enviado y no se manda dos veces. */}
              <WhatsAppButton
                clinicId={clinicId}
                patientId={c.pacienteId}
                appointmentId={c.id}
                templateKind="appointment_reminder"
                variant="full"
                label="WhatsApp"
                className={cn(
                  "justify-center rounded-full border-control px-3 text-[13px]",
                  tactil ? "h-11 flex-1" : "h-9 pointer-coarse:min-h-11",
                )}
                variables={{
                  tratamiento: c.tratamiento,
                  fecha_larga: c.fecha === hoy ? "hoy" : formatoFechaLarga(c.fecha),
                  hora: hora(c.inicio),
                  profesional: nombreProfesional.get(c.profesionalId) ?? "",
                  clinica: clinicaNombre,
                }}
              />
              <a
                href={tel ? `tel:${tel}` : undefined}
                aria-disabled={!tel}
                aria-label={`Llamar a ${c.paciente}`}
                title="Llamar"
                className={cn(
                  buttonVariants({ variant: "outline", size: "icon" }),
                  "rounded-full",
                  tactil && "size-11",
                  !tel && "pointer-events-none opacity-45",
                )}
              >
                <Phone aria-hidden />
              </a>
              <button
                type="button"
                disabled={enviando}
                onClick={() => confirmar.mutate(c.id)}
                className={cn(
                  buttonVariants({ size: "default" }),
                  "ml-auto rounded-full px-3.5 text-[13px]",
                  tactil && "h-11 flex-1",
                )}
              >
                <Check aria-hidden /> {enviando ? "…" : "Confirmó"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (variante === "aviso") {
    return (
      <section aria-label="Citas por confirmar">
        <div className="flex min-h-11 items-center gap-2.5 rounded-md border border-dashed border-warning-border bg-warning-soft px-3 text-sm text-warning">
          <Clock aria-hidden className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 truncate">
            <span className="font-semibold">
              {n} cita{n === 1 ? "" : "s"} por confirmar
            </span>
            {deHoy.length > 0 && (
              <span className="tabular-nums">
                {" "}
                · hoy {deHoy.map((c) => hora(c.inicio)).join(", ")}
              </span>
            )}
          </p>
          <button
            type="button"
            aria-expanded={abierta}
            aria-controls={abierta ? idLista : undefined}
            onClick={() => setAbierta((v) => !v)}
            className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 px-1 font-medium underline-offset-4 hover:underline"
          >
            {abierta ? "Ocultar" : "Ver"}
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform", abierta && "rotate-180")}
            />
          </button>
        </div>
        {abierta && <div className="mt-2">{lista}</div>}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="por-confirmar"
      className="overflow-hidden rounded-[14px] border border-hairline bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-[18px] pb-3">
        <h2
          id="por-confirmar"
          className="font-display text-[26px] font-medium leading-none whitespace-nowrap"
        >
          <span className="[font-variant-numeric:lining-nums]">{n}</span>{" "}
          <em className="text-brand-600">por confirmar</em>
        </h2>
        <span className="text-[13px] font-medium text-muted-foreground">Hoy y mañana</span>
      </div>
      {lista}
      {n > MAX_COMPACTA && (
        <Link
          to="/recordatorios"
          className="flex min-h-11 items-center border-t border-hairline px-5 text-sm font-semibold text-brand-700 outline-none hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          Ver las {n} →
        </Link>
      )}
    </section>
  );
}
