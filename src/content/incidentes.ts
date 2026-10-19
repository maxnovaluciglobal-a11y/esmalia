// Incidentes que se muestran en /estado.
//
// Se cargan a mano, en un PR, como cualquier otro cambio del repo: así quedan
// versionados, revisados y sin depender de un servicio externo de status page.
// La regla de cuándo se carga uno está en docs/SLO.md (sección 4): toda caída
// que consuma presupuesto de error o que una clínica haya notado.
//
// Formato de cada entrada (ejemplo, NO real):
//
// {
//   id: "2026-11-03-agenda-sin-guardar",
//   titulo: "La agenda no guardaba citas nuevas",
//   impacto: "parcial",
//   componentes: ["aplicacion"],
//   inicio: "2026-11-03T14:05:00Z",
//   fin: "2026-11-03T14:40:00Z",
//   actualizaciones: [
//     { fecha: "2026-11-03T14:12:00Z", fase: "investigando", mensaje: "Estamos revisando por qué la agenda no guarda." },
//     { fecha: "2026-11-03T14:40:00Z", fase: "resuelto", mensaje: "Volvimos a la versión anterior. Las citas se guardan con normalidad." },
//   ],
//   postmortem: "docs/post-mortems/2026-11-03-agenda-sin-guardar.md",
// }
//
// Fechas en UTC (ISO 8601 con `Z`). `fin: null` = en curso: la página lo
// muestra arriba y baja el estado general a "con incidentes". Al resolverlo,
// completar `fin` y agregar una actualización con fase "resuelto".
// tests/estado-servicio.test.ts valida esta lista en CI.
//
// Nada de datos de pacientes ni nombres de clínicas: esta página es pública.

export type ComponenteServicio =
  "aplicacion" | "base-de-datos" | "portal-pacientes" | "whatsapp" | "correos" | "pagos";

export type ImpactoIncidente = "menor" | "parcial" | "total";

export type FaseIncidente = "investigando" | "identificado" | "monitoreando" | "resuelto";

export interface ActualizacionIncidente {
  fecha: string;
  fase: FaseIncidente;
  mensaje: string;
}

export interface Incidente {
  /** `AAAA-MM-DD-tema`, único. */
  id: string;
  titulo: string;
  impacto: ImpactoIncidente;
  componentes: readonly ComponenteServicio[];
  inicio: string;
  /** null mientras el incidente sigue abierto. */
  fin: string | null;
  actualizaciones: readonly ActualizacionIncidente[];
  /** Ruta del post-mortem en el repo, si lo hay. */
  postmortem?: string;
}

export const INCIDENTES: readonly Incidente[] = [];
