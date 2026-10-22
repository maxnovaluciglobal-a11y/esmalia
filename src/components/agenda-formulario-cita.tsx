import { useEffect, useRef, type ReactNode } from "react";

import {
  AyudaProfesionales,
  CampoObservaciones,
  ChipsProcedimientos,
  CLASE_CAMPO,
  GrupoDeChips,
  SelectorBox,
  SelectorDuracion,
} from "@/components/cita-formulario";
import { AllergyAlertBanner } from "@/components/medical-history-card";
import { PatientCombobox } from "@/components/patient-combobox";
import { Label } from "@/components/ui/label";
import { idsDelFormulario, type FormularioCita } from "@/hooks/use-formulario-cita";
import {
  boxAlCambiarProfesional,
  profesionalesDelSelector,
} from "@/lib/clinic-operations/cita-formulario";
import { AvisoDeBloqueo } from "@/components/agenda-aviso-bloqueo";
import type { Profesional } from "@/lib/clinic-operations/clinic-data";

/**
 * Formulario de cita compartido por Nueva cita, Editar cita y Agendar
 * solicitud (Ola 1 · frente cita). Objetivo: una cita completa solo con el
 * teclado en 15 segundos o menos. Orden de los campos = orden del Tab:
 * paciente → tipo → sucursal/profesional → procedimiento → fecha y hora →
 * duración → box → observaciones.
 */

export function CamposCita({
  form,
  prefijo,
  sucursales,
  profesionales,
  /** Paciente elegible (Nueva cita). Sin esto, el paciente ya viene fijo. */
  pacientes,
  allergyAlerts,
  puedeAdministrarProfesionales,
  /** Al editar: el profesional actual se mantiene aunque ya no atienda. */
  profesionalActualId,
  /** Avisos que van al final (feriado, choques). */
  avisos,
  /**
   * Precarga el box por defecto del profesional que ya viene elegido al
   * abrir (Nueva cita, Agendar solicitud). Al editar no: la cita ya dice su
   * box. En los dos casos, cambiar de profesional precarga el suyo.
   */
  precargarBox = true,
}: {
  form: FormularioCita;
  prefijo: string;
  sucursales: { id: string; nombre: string }[];
  profesionales: Profesional[];
  pacientes?: { id: string; nombre: string }[];
  allergyAlerts?: Record<string, string[]>;
  puedeAdministrarProfesionales: boolean;
  profesionalActualId?: string;
  avisos?: ReactNode;
  precargarBox?: boolean;
}) {
  const ids = idsDelFormulario(prefijo);
  const { valores, set } = form;

  // Box por defecto del profesional (AGE-04): se aplica cuando cambia el
  // profesional y ya llegó el catálogo de boxes. Lo elegido a mano se
  // respeta (`boxAlCambiarProfesional`).
  const ultimoProfesional = useRef<string | null>(precargarBox ? null : valores.profesionalId);
  useEffect(() => {
    if (valores.profesionalId === ultimoProfesional.current) return;
    if (valores.profesionalId && form.boxes.length === 0) return;
    const anterior = profesionales.find((p) => p.id === ultimoProfesional.current);
    const nuevo = profesionales.find((p) => p.id === valores.profesionalId);
    if (valores.profesionalId && !nuevo) return;
    ultimoProfesional.current = valores.profesionalId;
    const box = boxAlCambiarProfesional({
      boxActual: valores.boxId,
      anterior,
      nuevo,
      boxes: form.boxes,
      sucursalId: valores.sucursalId,
    });
    if (box !== valores.boxId) set("boxId", box);
    // Solo importa el cambio de profesional y la llegada de los catálogos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valores.profesionalId, form.boxes, profesionales]);
  const disponibles = profesionalesDelSelector(
    profesionales,
    valores.sucursalId,
    profesionalActualId,
    form.sucursalesDeProfesional,
  );
  // Con una sola sucursal no hay nada que elegir: se completa sola y el
  // campo no se muestra (un Tab menos).
  const unaSucursal = sucursales.length === 1 && valores.sucursalId === sucursales[0].id;

  return (
    <div className="space-y-3">
      {pacientes && (
        <div className="space-y-1.5">
          <Label htmlFor={ids.paciente}>Paciente</Label>
          <PatientCombobox
            id={ids.paciente}
            value={valores.pacienteId}
            onChange={(id) => set("pacienteId", id)}
            pacientes={pacientes}
          />
          {valores.pacienteId && (
            <AllergyAlertBanner allergies={allergyAlerts?.[valores.pacienteId] ?? []} />
          )}
        </div>
      )}

      {form.tipos.length > 0 && (
        <div className="space-y-1.5">
          <p id={`${ids.tipo}-etiqueta`} className="text-sm font-medium leading-none">
            Tipo de cita <span className="font-normal text-muted-foreground">(opcional)</span>
          </p>
          <GrupoDeChips
            id={ids.tipo}
            etiqueta="Tipo de cita"
            opciones={form.tipos.map((t) => ({ value: t.id, label: t.nombre }))}
            value={valores.tipoId}
            onChange={(v) => set("tipoId", v)}
            permitirVacio
          />
        </div>
      )}

      <div className={unaSucursal ? "space-y-1.5" : "grid grid-cols-2 gap-3 max-sm:grid-cols-1"}>
        {!unaSucursal && (
          <div className="space-y-1.5">
            <Label htmlFor={ids.sucursal}>Sucursal</Label>
            <select
              id={ids.sucursal}
              value={valores.sucursalId}
              onChange={(e) =>
                form.setValores((v) => ({
                  ...v,
                  sucursalId: e.target.value,
                  profesionalId: "",
                  boxId: "",
                }))
              }
              className={CLASE_CAMPO}
            >
              <option value="">Elegir sucursal…</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={ids.profesional}>Profesional</Label>
          <select
            id={ids.profesional}
            value={valores.profesionalId}
            onChange={(e) => set("profesionalId", e.target.value)}
            aria-describedby={`${ids.profesional}-ayuda`}
            className={CLASE_CAMPO}
          >
            <option value="">Elegir profesional…</option>
            {disponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <div id={`${ids.profesional}-ayuda`}>
            <AyudaProfesionales puedeAdministrar={puedeAdministrarProfesionales} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.tratamiento}>Tratamiento / motivo</Label>
        <ChipsProcedimientos
          id={ids.frecuentes}
          procedimientos={form.frecuentes}
          favoritos={form.favoritos}
          seleccionadoId={form.procedimientoSeleccionado?.id ?? null}
          onElegir={form.elegirProcedimiento}
        />
        <input
          id={ids.tratamiento}
          value={valores.tratamiento}
          onChange={(e) => form.setTratamiento(e.target.value)}
          placeholder={
            form.frecuentes.length > 0 ? "U otro: escribe para buscar…" : "Ej: Control, limpieza…"
          }
          list={`${ids.tratamiento}-lista`}
          autoComplete="off"
          className={CLASE_CAMPO}
        />
        <datalist id={`${ids.tratamiento}-lista`}>
          {form.procedimientos.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        {form.procedimientoSeleccionado && (
          <p className="text-[11px] text-muted-foreground">
            Del arancel
            {form.procedimientoSeleccionado.durationMin
              ? ` · ${form.procedimientoSeleccionado.durationMin} min sugeridos`
              : ""}
            . Se reflejará en presupuestos futuros.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.inicio}>Fecha y hora</Label>
        <input
          id={ids.inicio}
          type="datetime-local"
          value={valores.startsAt}
          onChange={(e) => set("startsAt", e.target.value)}
          className={CLASE_CAMPO}
        />
      </div>

      <SelectorDuracion
        id={ids.duracion}
        value={valores.duracion}
        onChange={(m) => set("duracion", m)}
        onEditadaAMano={form.marcarDuracionManual}
        personalizada={form.duracionLibre}
        onPersonalizada={form.setDuracionLibre}
      />

      <SelectorBox
        id={ids.box}
        boxes={form.boxes}
        sucursalId={valores.sucursalId}
        value={valores.boxId}
        onChange={(b) => set("boxId", b)}
      />

      <CampoObservaciones
        id={ids.observaciones}
        value={valores.observaciones}
        onChange={(o) => set("observaciones", o)}
      />

      <AvisoDeBloqueo form={form} profesionales={profesionales} />

      {avisos}
    </div>
  );
}
