# Esmalia — guía de uso del logo

Versión 1 · 09-oct-2026 · **provisoria** (ver "Estado" al final).

Hoja visual para compartir: [`public/brand/guia.html`](../public/brand/guia.html) (en producción, `/brand/guia.html`).
Archivos: [`public/brand/`](../public/brand/). En la app, el logo es el componente `EsmaliaLogo` (`src/components/esmalia-logo.tsx`): no hace falta importar los SVG.

## Las versiones

| Archivo                         | Qué es                                                     | Para qué                                                                                    |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `esmalia-wordmark.svg`          | Wordmark principal: letras en tinta, arco de esmalte ocre. | La versión por defecto. Web, app, documentos, presentaciones, papelería.                    |
| `esmalia-wordmark-mono-ink.svg` | Wordmark todo en tinta `#201f1d`.                          | Impresión a una tinta, sellos, grabado, fax, fondos donde el ocre no se lee.                |
| `esmalia-wordmark-negative.svg` | Letras papel `#fbfaf8`, arco ocre claro `#e1ad66`.         | Fondos oscuros (tinta, fotos oscuras con buena zona lisa).                                  |
| `esmalia-vertical.svg`          | Monograma E centrado sobre el wordmark.                    | Formatos cuadrados o altos: portada de documento, carteles, credenciales, perfil de evento. |
| `esmalia-vertical-negative.svg` | La vertical para fondos oscuros.                           | Lo mismo, sobre tinta.                                                                      |
| `esmalia-monogram.svg`          | Monograma E en ocre oscuro `#7d5411`.                      | Ícono de app, favicon, avatar de redes, espacios chicos donde el wordmark no entra.         |
| `esmalia-monogram-mono.svg`     | Monograma E en tinta.                                      | Una sola tinta, marcas de agua, sellos.                                                     |
| `esmalia-monogram-negative.svg` | Monograma E en `#facb8d`.                                  | Fondos oscuros.                                                                             |

En React, las mismas variantes salen del componente:

```tsx
<EsmaliaLogo size={28} />                       // wordmark, sigue al tema claro/oscuro
<EsmaliaLogo size={28} tone="mono" />           // una sola tinta (color del texto)
<EsmaliaLogo size={28} tone="negative" />       // colores del modo oscuro sobre una superficie de tinta
<EsmaliaLogo size={32} variant="icon" />        // monograma
```

## Colores

Solo los del sistema (`src/styles.css`). Nada fuera de esta tabla.

| Uso             | Claro                 | Oscuro / negativo    |
| --------------- | --------------------- | -------------------- |
| Letras          | tinta `#201f1d`       | papel `#fbfaf8`      |
| Arco de esmalte | ocre `#b68235`        | ocre claro `#e1ad66` |
| Monograma       | ocre oscuro `#7d5411` | `#facb8d`            |

Contraste medido (WCAG, elemento gráfico pide 3:1):

- Arco `#b68235` sobre papel `#fbfaf8`: 3,23:1; sobre fondo `#f3f2f2`: 3,02:1. Pasa justo: no apoyar el wordmark a color sobre grises más oscuros que `#f3f2f2`; ahí va la versión monocromo.
- Con el papel y la tinta A+ de la app (19-oct-2026: fondo `#f4f2ee`, tarjeta `#fcfbf9`, tinta `#15120f`): arco sobre el fondo 3,01:1 y sobre la tarjeta 3,26:1, igual que antes. Los SVG del logo siguen con la tinta `#201f1d` y el papel `#fbfaf8`: la diferencia con los tokens nuevos no se ve a simple vista y no justifica regenerar los archivos de marca.
- Arco `#b68235` sobre tinta `#201f1d`: 4,89:1 (pasaría), pero en el negativo se usa `#e1ad66` (8,13:1), que es el `--brand` del modo oscuro: así el logo se ve igual en la app y en los archivos, y el arco no queda apagado al lado de letras casi blancas.
- Monograma `#7d5411` sobre papel: 6,39:1. Sobre tinta no sirve (2,47:1): usar el negativo `#facb8d` (10,97:1).

## Fondos permitidos

- **Papel** `#fbfaf8` (tarjetas) y **fondo** `#f3f2f2`: wordmark, vertical y monograma a color.
- **Tinta** `#201f1d` y tarjeta oscura `#232120`: solo las versiones `-negative`.
- **Fotografía**: solo sobre una zona lisa y pareja, clara (versión a color o monocromo) u oscura (negativo). Si hay que poner un velo para que se lea, la foto no sirve.
- Cualquier otro color de fondo: la versión monocromo en tinta, o no usar el logo.

## Tamaño mínimo

Se mide por el **alto** del dibujo completo (el ancho sale solo, la proporción del wordmark es 3,58:1).

| Versión   | Pantalla              | Impresión            |
| --------- | --------------------- | -------------------- |
| Wordmark  | 20 px (≈ 72 px ancho) | 6 mm (≈ 21 mm ancho) |
| Vertical  | 64 px                 | 16 mm                |
| Monograma | 16 px                 | 4 mm                 |

Debajo del mínimo del wordmark, el arco se vuelve una mancha y las astas finas desaparecen: usar el monograma. En la app hoy se usa entre 22 y 34 px de alto, dentro del rango.

## Zona de respeto

Unidad **x = alto de la "E"** del wordmark (≈ 86 % del alto total del logo; equivale a unas 6 veces el grosor del arco).

- Wordmark y vertical: dejar libre **½ x** alrededor, por los cuatro lados, medido desde el borde del dibujo (el arco incluido). A 28 px de alto son unos 12 px.
- Monograma: **¼ del alto del monograma** por lado. En un ícono de app, el monograma ocupa como máximo el 60 % del lado del cuadrado.
- En la zona de respeto no entra texto, otros logos, filetes ni bordes de la página.

## Lo que no se hace

- No estirar, comprimir, inclinar ni rotar. Escalar siempre en proporción.
- No recolorear fuera de la tabla de colores (ni degradados, ni el arco en otro color, ni la E en tinta con arco ocre "para combinar").
- No agregar efectos: sombras, contornos, brillos, relieve, 3D, transparencias sobre fotos.
- No dibujar dientes, muelas, sonrisas, cepillos ni cruces al lado del logo. La referencia dental ya está en el arco de esmalte y en la forma de la E; repetirla lo vuelve genérico.
- No reescribir "Esmalia" con una tipografía: el logo es un dibujo, siempre se usa el archivo.
- No separar el arco del wordmark ni moverlo de lugar, y no usar el arco suelto como ícono.
- No encerrar el wordmark en cajas, círculos ni pastillas.
- No combinar wordmark y monograma uno al lado del otro: si se necesitan los dos, usar la versión vertical.

## Tipografía

- El **wordmark no es texto**: son trazados (paths) vectoriales, sin fuente embebida. Abre igual en cualquier programa y no depende de tener nada instalado.
- La tipografía que acompaña a la marca (A+, desde el 19-oct-2026):
  - **Cormorant Garamond** para títulos y cifras grandes (de 400 a 600, con cifras alineadas `lnum`). La 500 itálica es el acento en ocre de los titulares.
  - **Instrument Sans** (variable, de 400 a 700) para el texto y toda la interfaz. Reemplaza a Lora.
  - **Geist Mono** (variable) solo para datos: horas de la agenda, montos en tablas, n.° de pieza FDI y fechas de versión. En el código es la utilidad `cifra` (`font-family` mono + `tabular-nums`) y se aplica a mano: una cifra dentro de una frase sigue en Instrument Sans. Reemplaza a "Esmalia Cifras" (Manrope en los dígitos por `unicode-range`).
- Las tres son de licencia **SIL Open Font License 1.1** (OFL): uso libre, también comercial, en web, impresión y apps; se pueden embeber; no se pueden vender sueltas. En la web se sirven desde el propio sitio vía `@fontsource` / `@fontsource-variable` (sin Google Fonts; la CSP solo permite `font-src 'self'`). Lo vigila `tests/tipografia.test.ts`.
- En los correos, la fuente web casi nunca carga y manda el respaldo: **Georgia** (decisión de Walter, 19-oct-2026). Los PDF (`jspdf`) siguen en Helvetica.
- Cormorant no es la letra del logo: el wordmark es un serif de alto contraste dibujado aparte. No usar Cormorant para "imitar" el logo.

## Estado: provisorio

Estos SVG salen de la decisión de nombre del 08-oct-2026: imágenes generadas con IA, vectorizadas y limpiadas en código (contraformas como agujeros reales, sin fondo, svgo a precisión 1). Son vectores reales y sirven para usar ya, pero no son un logo final:

- Las curvas tienen pequeñas irregularidades del vectorizado (más visibles por encima de ~400 px de alto o en impresión grande).
- No hay versión con ajuste óptico para tamaños chicos ni un monograma redibujado para 16 px.
- Falta la búsqueda de marca registrada formal.

Cuando haya presupuesto, un diseñador debe redibujar wordmark, arco y monograma sobre esta misma geometría (sin rediseñar) y entregar los archivos finales. Al reemplazarlos: actualizar los trazados de `src/components/esmalia-logo.tsx`, `scripts/marca/*.svg`, estos archivos de `public/brand/`, y regenerar íconos y OG (`scripts/generar-iconos.sh`, `node scripts/generar-og.mjs`).
