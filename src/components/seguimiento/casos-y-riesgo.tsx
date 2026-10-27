import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Plus } from "lucide-react";
import { toast } from "sonner";

import { ChipFiltro, FiltroCompacto } from "@/components/a-plus/lista";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { BOTON_FILA, Chip, PanelLista, Vacio, type Tono } from "@/components/seguimiento/piezas";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  ETIQUETA_DETENCION,
  OPCIONES_DIAS_DETENIDO,
  type CasoDetenido,
} from "@/lib/seguimiento/detenidos";
import { ETIQUETA_NIVEL, type NivelDeRiesgo } from "@/lib/seguimiento/riesgo";
import { crearTarea, type PacienteEnRiesgo } from "@/lib/seguimiento/seguimiento.functions";

const BUSQUEDA_AGENDA = {
  q: "",
  fecha: "",
  sucursal: "",
  profesional: "",
  estado: "",
  page: 1,
} as const;

function useCrearTareaDeSeguimiento(
  clinicId: string,
  userId: string,
  hoy: string,
  onCreada: () => void,
) {
  const crear = useServerFn(crearTarea);
  return useMutation({
    mutationFn: (v: { clave: string; titulo: string; patientId: string; tipo: "llamada" }) =>
      crear({
        data: {
          clinicId,
          titulo: v.titulo.slice(0, 160),
          notas: null,
          tipo: v.tipo,
          patientId: v.patientId,
          quoteId: null,
          controlId: null,
          asignarA: userId,
          fecha: hoy,
        },
      }),
    onSuccess: () => {
      toast.success("Tarea creada.");
      onCreada();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
}

/** CRM-06 · Planes aceptados que no avanzan y tratamientos a medias. */
export function CasosDetenidos({
  clinicId,
  userId,
  hoy,
  zona,
  dias,
  onDias,
  casos,
  onCambio,
}: {
  clinicId: string;
  userId: string;
  hoy: string;
  zona: string;
  dias: number;
  onDias: (d: number) => void;
  casos: readonly CasoDetenido[];
  onCambio: () => void;
}) {
  const [tipo, setTipo] = useState<"todos" | "sin_empezar" | "a_medias">("todos");
  const tarea = useCrearTareaDeSeguimiento(clinicId, userId, hoy, onCambio);
  const visibles = casos.filter((c) => tipo === "todos" || c.tipo === tipo);
  const n = (t: "sin_empezar" | "a_medias") => casos.filter((c) => c.tipo === t).length;
  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <FiltroCompacto
          etiqueta="Sin avance desde"
          valor={dias === 30 ? "" : String(dias)}
          onChange={(v) => onDias(v ? Number(v) : 30)}
          todas="Sin avance hace 30 días"
          opciones={OPCIONES_DIAS_DETENIDO.filter((d) => d !== 30).map((d) => ({
            value: String(d),
            label: `Sin avance hace ${d} días`,
          }))}
        />
        <div role="group" aria-label="Tipo de caso" className="flex flex-wrap gap-1.5">
          <ChipFiltro activo={tipo === "todos"} onClick={() => setTipo("todos")}>
            Todos <span className="cifra text-[11px] opacity-75">{casos.length}</span>
          </ChipFiltro>
          <ChipFiltro activo={tipo === "sin_empezar"} onClick={() => setTipo("sin_empezar")}>
            Sin empezar <span className="cifra text-[11px] opacity-75">{n("sin_empezar")}</span>
          </ChipFiltro>
          <ChipFiltro activo={tipo === "a_medias"} onClick={() => setTipo("a_medias")}>
            A medias <span className="cifra text-[11px] opacity-75">{n("a_medias")}</span>
          </ChipFiltro>
        </div>
      </div>
      <PanelLista
        titulo="Casos detenidos"
        conteo={visibles.length}
        descripcion="Planes de tratamiento activos con prestaciones pendientes, sin cita agendada y sin atención en el plazo elegido."
      >
        {visibles.length === 0 ? (
          <Vacio>No hay planes detenidos con este plazo.</Vacio>
        ) : (
          <ul className="divide-y divide-hairline">
            {visibles.map((c) => {
              const total = c.itemsCompletados + c.itemsPendientes;
              return (
                <li
                  key={c.planId}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: c.patientId }}
                        className="text-[15px] font-semibold underline-offset-2 hover:underline"
                      >
                        {c.patientName}
                      </Link>
                      <Chip tono={c.tipo === "a_medias" ? "aviso" : "neutro"}>
                        {ETIQUETA_DETENCION[c.tipo]}
                      </Chip>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {c.planName} ·{" "}
                      <span className="cifra">
                        {c.itemsCompletados}/{total}
                      </span>{" "}
                      prestaciones hechas · sin avance desde el {fecha(c.ultimaActividadEl, zona)} (
                      <span className="cifra">{c.diasSinAvance}</span> días)
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      to="/agenda"
                      search={{ ...BUSQUEDA_AGENDA, nueva: c.patientId }}
                      className={BOTON_FILA}
                    >
                      <CalendarPlus className="size-3.5" aria-hidden /> Agendar
                    </Link>
                    <BloqueoEscritura>
                      <button
                        type="button"
                        disabled={tarea.isPending}
                        onClick={() =>
                          tarea.mutate({
                            clave: c.planId,
                            titulo: `Retomar tratamiento: ${c.planName}`,
                            patientId: c.patientId,
                            tipo: "llamada",
                          })
                        }
                        className={BOTON_FILA}
                      >
                        <Plus className="size-3.5" aria-hidden /> Tarea
                      </button>
                    </BloqueoEscritura>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelLista>
    </div>
  );
}

const TONO_NIVEL: Record<NivelDeRiesgo, Tono> = { alto: "alerta", medio: "aviso", bajo: "neutro" };

/** CRM-07 · Riesgo de abandono: puntaje explicable, ordenado de mayor a menor. */
export function RiesgoDeAbandono({
  clinicId,
  userId,
  hoy,
  zona,
  pacientes,
  sinDatos,
  saldoConocido,
  onCambio,
}: {
  clinicId: string;
  userId: string;
  hoy: string;
  zona: string;
  pacientes: readonly PacienteEnRiesgo[];
  sinDatos: number;
  saldoConocido: boolean;
  onCambio: () => void;
}) {
  const [nivel, setNivel] = useState<NivelDeRiesgo | "todos">("todos");
  const tarea = useCrearTareaDeSeguimiento(clinicId, userId, hoy, onCambio);
  const n = (x: NivelDeRiesgo) => pacientes.filter((p) => p.riesgo.nivel === x).length;
  const visibles = pacientes.filter((p) => nivel === "todos" || p.riesgo.nivel === nivel);
  return (
    <div className="space-y-[18px]">
      <div role="group" aria-label="Nivel de riesgo" className="flex flex-wrap gap-1.5">
        {(["alto", "medio", "bajo"] as const).map((x) => (
          <ChipFiltro key={x} activo={nivel === x} onClick={() => setNivel(x)}>
            {ETIQUETA_NIVEL[x]} <span className="cifra text-[11px] opacity-75">{n(x)}</span>
          </ChipFiltro>
        ))}
        <ChipFiltro activo={nivel === "todos"} onClick={() => setNivel("todos")}>
          Todos <span className="cifra text-[11px] opacity-75">{pacientes.length}</span>
        </ChipFiltro>
      </div>
      <PanelLista
        titulo="Riesgo de abandono"
        conteo={visibles.length}
        descripcion={
          <>
            Puntaje de 0 a 100 que suma tiempo sin visita, inasistencias, cancelaciones,
            presupuestos rechazados{saldoConocido ? ", saldo" : ""} y tratamientos detenidos, y
            resta si ya tiene cita.{" "}
            {sinDatos > 0 && `${sinDatos} pacientes sin visitas atendidas quedan sin datos.`}
          </>
        }
      >
        {visibles.length === 0 ? (
          <Vacio>Nadie en este nivel.</Vacio>
        ) : (
          <ul className="divide-y divide-hairline">
            {visibles.slice(0, 150).map((p) => (
              <li
                key={p.patientId}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="cifra grid size-10 shrink-0 place-items-center rounded-full border border-foreground text-sm font-semibold"
                    aria-label={`Puntaje ${p.riesgo.puntaje ?? "sin datos"}`}
                  >
                    {p.riesgo.puntaje ?? "—"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: p.patientId }}
                        className="text-[15px] font-semibold underline-offset-2 hover:underline"
                      >
                        {p.nombre}
                      </Link>
                      {p.riesgo.nivel && (
                        <Chip tono={TONO_NIVEL[p.riesgo.nivel]}>
                          {ETIQUETA_NIVEL[p.riesgo.nivel]}
                        </Chip>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {p.ultimaVisita
                        ? `Última visita: ${fecha(p.ultimaVisita, zona)}`
                        : "Sin visitas"}
                      {p.telefono && <span className="cifra"> · {p.telefono}</span>}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Por qué">
                      {p.riesgo.factores.map((f) => (
                        <li key={f.clave}>
                          <Chip tono={f.puntos < 0 ? "bien" : "tenue"}>
                            {f.texto}{" "}
                            <span className="cifra opacity-75">
                              {f.puntos > 0 ? `+${f.puntos}` : f.puntos}
                            </span>
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-[52px] sm:pl-0">
                  {!p.tieneCitaFutura && (
                    <Link
                      to="/agenda"
                      search={{ ...BUSQUEDA_AGENDA, nueva: p.patientId }}
                      className={BOTON_FILA}
                    >
                      <CalendarPlus className="size-3.5" aria-hidden /> Agendar
                    </Link>
                  )}
                  <BloqueoEscritura>
                    <button
                      type="button"
                      disabled={tarea.isPending}
                      onClick={() =>
                        tarea.mutate({
                          clave: p.patientId,
                          titulo: `Llamar a ${p.nombre}: riesgo de abandono`,
                          patientId: p.patientId,
                          tipo: "llamada",
                        })
                      }
                      className={BOTON_FILA}
                    >
                      <Plus className="size-3.5" aria-hidden /> Tarea
                    </button>
                  </BloqueoEscritura>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelLista>
    </div>
  );
}
