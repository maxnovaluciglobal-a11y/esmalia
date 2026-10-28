import { pasosDeClinica } from "@/lib/demo/cobertura-clinica.server";
import { pasosDeFichas } from "@/lib/demo/cobertura-fichas.server";
import { pasosDeCumplimiento } from "@/lib/demo/cobertura-cumplimiento.server";
import {
  pasosDeCompletado,
  pasosDeHistorial,
  pasosDePacientesInactivos,
} from "@/lib/demo/cobertura-historial.server";
import { pasosDePacientes } from "@/lib/demo/cobertura-pacientes.server";
import type { Admin, PasoDeSiembra } from "@/lib/demo/contexto.server";

/**
 * Pasos de la "demo completa" (cierre del 28-oct-2026): cada sección, pantalla y
 * configuración de la app muestra al menos un valor genérico creíble, de modo que quien
 * entra a la demo siempre ve correspondencia. Se agregan después de los pasos de las olas
 * 0-14 (`reseteo.server.ts`) y son idempotentes. La lista de áreas que deben quedar con
 * datos, y su mínimo, es `AREAS_DE_LA_DEMO` (`areas.ts`).
 */
/**
 * Historial, equipo y configuración: van ANTES de «caja y comisiones», cuyas liquidaciones del mes
 * pasado se calculan con lo realizado y cobrado en ese momento.
 */
export function pasosDeHistorialDeLaDemo(admin: Admin): PasoDeSiembra[] {
  return [...pasosDeClinica(admin), ...pasosDeHistorial(admin)];
}

/** El resto de la cobertura: fichas, relación con el paciente y cumplimiento. */
export function pasosDeCoberturaDeLaDemo(admin: Admin): PasoDeSiembra[] {
  return [
    ...pasosDePacientesInactivos(admin),
    ...pasosDeFichas(admin),
    ...pasosDePacientes(admin),
    ...pasosDeCumplimiento(admin),
    ...pasosDeCompletado(admin),
  ];
}
