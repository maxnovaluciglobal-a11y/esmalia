import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, Eye, EyeOff, ShieldCheck, UserRound } from "lucide-react";

import { AccionesDeLaFicha } from "@/components/ficha-acciones";
import { AvisoGes } from "@/components/ficha-ola1";
import type { ClinicAccess } from "@/lib/access/access";
import type { AlertaClinica } from "@/lib/clinical/anamnesis";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { enmascararDocumento, partirNombre } from "@/lib/patients/encabezado-ficha";
import type { MotivoGes } from "@/lib/patients/ges";
import { cn } from "@/lib/utils";

const BUSQUEDA_LISTADO = {
  q: "",
  sucursal: "",
  profesional: "",
  estado: "",
  desde: "",
  hasta: "",
  page: 1,
} as const;

/**
 * Encabezado editorial de la ficha (A+, dirección A del prototipo): bloque
 * en tinta con el nombre grande en Cormorant (apellidos en itálica ocre), los
 * datos clave en una línea de Geist Mono (edad, documento enmascarado,
 * previsión, teléfono, convenio), las alertas clínicas como píldoras y las
 * acciones a la derecha. Lleva `.dark` para que todo lo de adentro (foco,
 * botones, GES) se lea sobre tinta; `tinta-de-pagina` evita que en claro se
 * hunda el fondo (mismo recurso que el sidebar del shell).
 *
 * Las alertas críticas (alergias, anticoagulantes, embarazo) van rellenas en
 * rojo claro sobre tinta; las precauciones, con contorno. GES y "menor de
 * edad" van en la misma fila. Sin animaciones (calma de recepción).
 */
export function EncabezadoPaciente({
  access,
  paciente,
  lineaPrevision,
  puedeVerClinico,
  cargandoAlertas,
  alertasCriticas,
  precauciones,
  motivosGes,
  menor,
  onCobrar,
}: {
  access: ClinicAccess;
  paciente: Paciente;
  /** "Fonasa B", "Isapre Consalud"… solo en Chile; `null` fuera. */
  lineaPrevision: string | null;
  puedeVerClinico: boolean;
  cargandoAlertas: boolean;
  alertasCriticas: AlertaClinica[];
  precauciones: AlertaClinica[];
  motivosGes: readonly MotivoGes[];
  /** Menor de edad con su tutor (o sin tutor registrado); `null` si no aplica. */
  menor: { tutor: string | null } | null;
  onCobrar: () => void;
}) {
  const [verDocumento, setVerDocumento] = useState(false);
  const { primero, resto } = partirNombre(paciente.nombre);
  const documento = paciente.documento?.trim() ?? "";
  const telefono = paciente.telefono?.trim() ?? "";

  return (
    <header className="dark tinta-de-pagina relative isolate overflow-hidden rounded-panel bg-night px-5 py-6 text-on-night sm:px-8 sm:py-8">
      {/* Filete circular del prototipo: decoración, sin movimiento. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-16 -z-10 size-[340px] rounded-full border border-night-line"
      />
      <div>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-on-night-2">
            <Link
              to="/pacientes"
              search={BUSQUEDA_LISTADO}
              className="inline-flex min-h-9 items-center font-semibold text-on-night hover:underline"
            >
              Pacientes
            </Link>
            <span aria-hidden>·</span>
            <span>Ficha clínica</span>
          </p>
          <h2 className="mt-1 font-display text-[44px] leading-[0.95] font-medium tracking-[-0.02em] break-words sm:text-[56px] xl:text-[72px]">
            {primero}
            {resto && (
              <>
                {" "}
                <em className="text-brand">{resto}</em>
              </>
            )}
          </h2>

          <dl className="cifra mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-[13px] text-on-night-2">
            {paciente.edad > 0 && (
              <div>
                <dt className="sr-only">Edad</dt>
                <dd>
                  <b className="font-medium text-on-night">{paciente.edad}</b> años
                </dd>
              </div>
            )}
            <div className="flex items-center gap-1">
              <dt className="sr-only">Documento</dt>
              <dd className="inline-flex items-center gap-1">
                {documento ? (
                  <>
                    <span>
                      {paciente.documentoTipo === "rut" || !paciente.documentoTipo ? "RUT" : "Doc."}{" "}
                      <span className="text-on-night">
                        {verDocumento ? documento : enmascararDocumento(documento)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setVerDocumento((v) => !v)}
                      aria-pressed={verDocumento}
                      aria-label={verDocumento ? "Ocultar el documento" : "Mostrar el documento"}
                      className="grid size-8 place-items-center rounded-full text-on-night-2 hover:text-on-night"
                    >
                      {verDocumento ? (
                        <EyeOff className="size-3.5" aria-hidden />
                      ) : (
                        <Eye className="size-3.5" aria-hidden />
                      )}
                    </button>
                  </>
                ) : (
                  "Sin documento"
                )}
              </dd>
            </div>
            {lineaPrevision && (
              <div>
                <dt className="sr-only">Previsión</dt>
                <dd>{lineaPrevision === "Pendiente" ? "Previsión pendiente" : lineaPrevision}</dd>
              </div>
            )}
            <div>
              <dt className="sr-only">Teléfono</dt>
              <dd className="inline-flex items-center gap-1.5">
                {telefono ? (
                  <a
                    href={`tel:${telefono.replace(/[^+\d]/g, "")}`}
                    className="inline-flex min-h-8 items-center text-on-night hover:underline"
                  >
                    {telefono}
                  </a>
                ) : (
                  "Sin teléfono"
                )}
                {telefono && paciente.telefonoValido === false && (
                  <span className="inline-flex items-center gap-1 font-sans text-warning">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> formato dudoso
                  </span>
                )}
              </dd>
            </div>
            {paciente.convenioNombre && (
              <div>
                <dt className="sr-only">Convenio</dt>
                <dd>{paciente.convenioNombre}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Alertas a la izquierda y acciones a la derecha, en la misma fila
            (en el celular, las acciones bajan). */}
        <div className="mt-[18px] flex flex-wrap items-end justify-between gap-x-7 gap-y-5">
          <div className="min-w-0">
            <ul className="flex flex-wrap gap-2" aria-label="Alertas clínicas">
              {!puedeVerClinico ? (
                <li className="inline-flex h-[34px] items-center gap-2 rounded-full border border-night-line px-3.5 text-[13.5px] font-semibold text-on-night-2">
                  <ShieldCheck className="size-4" aria-hidden /> Alertas clínicas: tu rol no tiene
                  acceso
                </li>
              ) : cargandoAlertas ? (
                <li aria-hidden>
                  <span className="block h-[34px] w-56 animate-pulse rounded-full bg-night-3 motion-reduce:animate-none" />
                </li>
              ) : (
                <>
                  {alertasCriticas.map((a) => (
                    <li
                      key={a.clave}
                      className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-destructive bg-destructive px-3.5 py-1 text-[13.5px] font-semibold text-destructive-foreground"
                    >
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      {a.texto}
                    </li>
                  ))}
                  {precauciones.map((a) => (
                    <li
                      key={a.clave}
                      className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-warning px-3.5 py-1 text-[13.5px] font-semibold text-warning"
                    >
                      <Activity className="size-4 shrink-0" aria-hidden />
                      {a.texto}
                    </li>
                  ))}
                  {alertasCriticas.length === 0 && precauciones.length === 0 && (
                    <li className="inline-flex h-[34px] items-center gap-2 rounded-full border border-night-line px-3.5 text-[13.5px] font-semibold text-on-night-2">
                      <ShieldCheck className="size-4" aria-hidden /> Sin alertas clínicas
                      registradas
                    </li>
                  )}
                </>
              )}
              {menor && (
                <li
                  className={cn(
                    "inline-flex min-h-[34px] items-center gap-2 rounded-full border px-3.5 py-1 text-[13.5px] font-semibold",
                    menor.tutor
                      ? "border-night-line text-on-night"
                      : "border-destructive text-destructive",
                  )}
                >
                  {menor.tutor ? (
                    <UserRound className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  )}
                  Menor de edad · {menor.tutor ? `Tutor: ${menor.tutor}` : "sin tutor registrado"}
                </li>
              )}
            </ul>
            <AvisoGes motivos={motivosGes} />
          </div>

          <AccionesDeLaFicha access={access} paciente={paciente} onCobrar={onCobrar} tono="noche" />
        </div>
      </div>
    </header>
  );
}
