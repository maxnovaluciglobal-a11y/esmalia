// src/content/ayuda/indice.ts
//
// Índice del buscador de la ayuda (ONB-10): la ayuda de cada pantalla, las
// lecciones de la Academia, las guías públicas de /docs (reutilizadas tal
// cual, se abren en otra pestaña) y las novedades.
//
// Las lecciones se filtran por rol ANTES de buscar (`articulosDeAyuda`):
// nadie encuentra una lección que su rol no ve en la Academia.
import type { ClinicRole } from "@/lib/access/access";
import type { ArticuloBuscable } from "@/lib/ayuda/buscador";
import { leccionesVisibles } from "@/lib/ayuda/academia";
import { LECCIONES } from "@/content/ayuda/academia";
import { NOVEDADES } from "@/content/ayuda/novedades";
import { AYUDA_PANTALLAS } from "@/content/ayuda/pantallas";

/** Guías públicas de /docs (mismo título y resumen que su índice). */
export const GUIAS_DOCS: readonly {
  href: string;
  titulo: string;
  resumen: string;
  palabras: string[];
}[] = [
  {
    href: "/docs/primeros-pasos",
    titulo: "Primeros pasos",
    resumen: "Cómo dar de alta tu clínica, cargar pacientes y agendar tu primera cita.",
    palabras: ["empezar", "alta", "inicio", "configurar"],
  },
  {
    href: "/docs/migrar-desde-otro-sistema",
    titulo: "Migrar desde otro sistema",
    resumen:
      "Plantillas CSV para traer tus pacientes y citas, qué se importa y cómo correr los dos sistemas en paralelo.",
    palabras: ["importar", "csv", "excel", "dentalink", "migracion"],
  },
  {
    href: "/docs/suscripcion-y-prueba",
    titulo: "Prueba y suscripción",
    resumen: "Cómo funciona la prueba gratis, cómo te suscribes y qué pasa si un pago falla.",
    palabras: ["precio", "pago", "plan", "factura", "suscripcion", "prueba"],
  },
  {
    href: "/docs/exportar-tus-datos",
    titulo: "Exportar tus datos",
    resumen: "Cómo sacar todos los datos de tu clínica, o la ficha de un paciente, cuando quieras.",
    palabras: ["exportar", "descargar", "respaldo", "zip"],
  },
  {
    href: "/docs/whatsapp",
    titulo: "Conectar WhatsApp",
    resumen: "Diferencia entre el modo manual (wa.me) y conectar el número real de tu clínica.",
    palabras: ["whatsapp", "meta", "numero", "mensajes"],
  },
  {
    href: "/docs/portal-pacientes",
    titulo: "Portal de pacientes",
    resumen: "Cómo tus pacientes piden citas solos, sin crear una cuenta.",
    palabras: ["portal", "paciente", "solicitud"],
  },
  {
    href: "/docs/datos-y-seguridad",
    titulo: "Datos y seguridad",
    resumen: "Dónde vive la información de tu clínica y cómo está aislada de otras clínicas.",
    palabras: ["seguridad", "privacidad", "datos", "verificacion en dos pasos"],
  },
];

/** Todos los artículos que el rol puede encontrar. */
export function articulosDeAyuda(role: ClinicRole | null | undefined): ArticuloBuscable[] {
  const pantallas: ArticuloBuscable[] = AYUDA_PANTALLAS.map((p) => ({
    id: `pantalla-${p.id}`,
    tipo: "pantalla",
    titulo: p.nombre,
    resumen: p.resumen,
    texto: [...p.pasos.flatMap((x) => [x.titulo, x.texto]), ...p.tenEnCuenta].join(" "),
    palabras: p.palabras,
    href: `/ayuda/pantalla/${p.id}`,
  }));
  const lecciones: ArticuloBuscable[] = leccionesVisibles(LECCIONES, role).map((l) => ({
    id: `leccion-${l.id}`,
    tipo: "leccion",
    titulo: l.titulo,
    resumen: l.cuerpo[0] ?? "",
    texto: l.cuerpo.join(" "),
    palabras: [],
    href: `/ayuda/academia#${l.id}`,
  }));
  const guias: ArticuloBuscable[] = GUIAS_DOCS.map((g) => ({
    id: `guia-${g.href}`,
    tipo: "guia",
    titulo: g.titulo,
    resumen: g.resumen,
    texto: "",
    palabras: g.palabras,
    href: g.href,
  }));
  const novedades: ArticuloBuscable[] = NOVEDADES.map((n) => ({
    id: `novedad-${n.id}`,
    tipo: "novedad",
    titulo: n.titulo,
    resumen: n.texto,
    texto: "",
    palabras: [],
    href: `/ayuda/novedades#${n.id}`,
  }));
  return [...pantallas, ...lecciones, ...guias, ...novedades];
}
