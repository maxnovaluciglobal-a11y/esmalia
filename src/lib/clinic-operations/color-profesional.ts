/**
 * Color por profesional en la agenda (AGE-06, Ola 2 · frente boxes y grilla).
 *
 * Cada profesional tiene uno de ocho colores de una paleta de tokens
 * (`--prof-1` … `--prof-8` en styles.css), con un valor para el modo claro y
 * otro para el oscuro. Los dos pasan 3:1 contra la tarjeta (WCAG 1.4.11,
 * contraste de componentes que no son texto): el color marca el borde y el
 * punto de cada cita, nunca el texto. Lo vigila tests/color-profesional.test.ts.
 *
 * Qué se guarda: `professionals.color` sigue siendo un hex, el del modo
 * claro del token elegido. Así no hace falta migración y el código anterior
 * (que pinta el hex tal cual) sigue funcionando. Para dibujar, el hex se
 * lleva al token más cercano: los colores elegidos con la paleta caen
 * exacto, y los que se eligieron antes con el selector libre caen en el
 * parecido, con su versión accesible y su versión oscura.
 */

export interface ColorDePaleta {
  token: `prof-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
  nombre: string;
  /** Valor en modo claro (el que se guarda en `professionals.color`). */
  claro: string;
  /** Valor en modo oscuro. */
  oscuro: string;
}

export const PALETA_PROFESIONALES: readonly ColorDePaleta[] = [
  { token: "prof-1", nombre: "Ocre", claro: "#8f621e", oscuro: "#e1ad66" },
  { token: "prof-2", nombre: "Petróleo", claro: "#0f5e63", oscuro: "#5fb3b8" },
  { token: "prof-3", nombre: "Terracota", claro: "#a4452a", oscuro: "#ec9474" },
  { token: "prof-4", nombre: "Musgo", claro: "#4f6b2a", oscuro: "#a9c27a" },
  { token: "prof-5", nombre: "Ciruela", claro: "#7a3f73", oscuro: "#d39acb" },
  { token: "prof-6", nombre: "Índigo", claro: "#4a4f9c", oscuro: "#a5abee" },
  { token: "prof-7", nombre: "Pizarra", claro: "#4d5a66", oscuro: "#a9b5c0" },
  { token: "prof-8", nombre: "Frambuesa", claro: "#a63d5c", oscuro: "#ee8fa8" },
];

/** Color que toma un profesional nuevo si nadie elige otro. */
export const COLOR_PROFESIONAL_POR_DEFECTO = PALETA_PROFESIONALES[0].claro;

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Token de la paleta para un color guardado. Exacto si es de la paleta; si
 * no, el más cercano (distancia RGB con peso perceptual). Un valor que no se
 * lee como hex cae en el primero.
 */
export function colorDePaleta(guardado: string | null | undefined): ColorDePaleta {
  const exacto = PALETA_PROFESIONALES.find(
    (c) => c.claro.toLowerCase() === guardado?.trim().toLowerCase(),
  );
  if (exacto) return exacto;
  const valor = guardado ? rgb(guardado) : null;
  if (!valor) return PALETA_PROFESIONALES[0];
  let mejor = PALETA_PROFESIONALES[0];
  let distancia = Number.POSITIVE_INFINITY;
  for (const c of PALETA_PROFESIONALES) {
    const [r, g, b] = rgb(c.claro)!;
    const rm = (valor[0] + r) / 2;
    const d =
      (2 + rm / 256) * (valor[0] - r) ** 2 +
      4 * (valor[1] - g) ** 2 +
      (2 + (255 - rm) / 256) * (valor[2] - b) ** 2;
    if (d < distancia) {
      distancia = d;
      mejor = c;
    }
  }
  return mejor;
}

/** Valor CSS para `style`: el token, que cambia solo con el modo oscuro. */
export function colorProfesional(guardado: string | null | undefined): string {
  return `var(--${colorDePaleta(guardado).token})`;
}

/** Luminancia relativa (WCAG 2.x). */
export function luminancia(hex: string): number {
  const valor = rgb(hex);
  if (!valor) return 0;
  const [r, g, b] = valor.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre dos colores (1 a 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
