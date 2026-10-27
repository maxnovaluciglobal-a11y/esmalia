// src/content/ayuda/tipos.ts
//
// Tipos del contenido de ayuda de la app (Ola 12): ayuda por pantalla
// (ONB-02), recorridos (ONB-03), Academia por rol (ONB-04), novedades
// (NAV-10) y videos de la puesta en marcha (ONB-01).
//
// Regla del contenido: todo lo que dice tiene que ser verdad en el código de
// hoy. Si una función depende de algo externo (Meta, Patty, factura
// electrónica), se dice. Los videos los graba o aprueba Walter: mientras no
// existan, quedan `pendiente` con su guion y la app muestra "Video pendiente".

import type { Permission } from "@/lib/access/access";

/** Un video de ayuda. Nunca se inventa un enlace: sin URL real, `pendiente`. */
export type Video =
  | {
      estado: "pendiente";
      /** Duración sugerida, ej. "2 min". */
      duracion: string;
      /** Guion breve para grabarlo. */
      guion: string;
    }
  | {
      estado: "listo";
      duracion: string;
      guion: string;
      /** Enlace https al video aprobado por Walter (se abre en otra pestaña). */
      url: string;
    };

/** Pistas de la Academia. Agrupan los roles de la app (ver `pistasDelRol`). */
export type PistaAcademia = "dueno" | "profesional" | "recepcion" | "asistente" | "tecnico";

/** Pantallas principales con ayuda propia. */
export type PantallaId =
  | "hoy"
  | "agenda"
  | "mi-agenda"
  | "pacientes"
  | "ficha"
  | "presupuestos"
  | "caja"
  | "cuentas-por-cobrar"
  | "finanzas"
  | "informes"
  | "seguimiento"
  | "campanas"
  | "recordatorios"
  | "mensajes"
  | "reserva-en-linea"
  | "laboratorios"
  | "inventario"
  | "comisiones"
  | "equipo"
  | "notificaciones"
  | "ajustes";

/** Ayuda "Cómo se usa esta pantalla" (ONB-02): breve y verdadera. */
export type AyudaPantalla = {
  id: PantallaId;
  /** Nombre de la pantalla tal como se ve en el menú. */
  nombre: string;
  /** Para qué sirve, en una oración. */
  resumen: string;
  /** Lo que se hace acá, en pasos cortos (3 a 6). */
  pasos: { titulo: string; texto: string }[];
  /** Límites y cuidados reales (qué es manual, qué depende de otro). */
  tenEnCuenta: string[];
  /** Sinónimos para el buscador ("abono" → caja). */
  palabras: string[];
  video: Video;
};

/** Un paso de un recorrido guiado (ONB-03). */
export type PasoRecorrido = {
  /** Selector CSS del elemento a resaltar. Si no está en la pantalla
   *  (otra vista, otro rol, celular), el paso se muestra centrado. */
  selector: string | null;
  titulo: string;
  texto: string;
};

export type Recorrido = {
  /** Mismo id que la pantalla. */
  id: PantallaId;
  pasos: PasoRecorrido[];
};

/** Lección de la Academia (ONB-04). */
export type Leccion = {
  /** Id estable (se guarda como progreso): kebab-case. */
  id: string;
  titulo: string;
  /** Pistas que la ven. "todas" = lo básico, para todo el equipo. */
  pistas: readonly PistaAcademia[] | "todas";
  minutos: number;
  /** Párrafos cortos. */
  cuerpo: string[];
  /** Pantalla para practicar, si aplica. */
  pantalla?: PantallaId;
  video: Video;
};

/** Novedad (NAV-10): un cambio reciente contado para la clínica. */
export type Novedad = {
  /** Id estable (se guarda como leída): kebab-case. */
  id: string;
  /** AAAA-MM-DD en que llegó a producción. */
  fecha: string;
  titulo: string;
  texto: string;
  /** Dónde verlo en la app, si hay un lugar. Con `permiso`, el enlace se
   *  muestra solo a quien puede abrir esa pantalla. */
  enlace?: { href: string; texto: string; permiso?: Permission };
};
