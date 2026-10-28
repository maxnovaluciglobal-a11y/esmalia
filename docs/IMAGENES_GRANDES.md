# Imágenes grandes: CBCT, escaneos intraorales y sus visores

Cómo se suben y se abren los exámenes pesados (28-oct-2026). Medición con archivos sintéticos realistas: `../../00 - Gestion/auditorias/2026-10-28-imagenes-3d/LEEME.md` (fuera del repo).

## Límites

| Qué                                    | Valor                        | Dónde vive                                                                                                    |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Por archivo, CBCT y escaneo intraoral  | **200 MB**                   | `LIMITE_PESADO` (`src/lib/examenes/tipos.ts`) y `limite_por_archivo_de_examen()` (migración `20261116100000`) |
| Por archivo, fotos y radiografías      | 20 MB                        | `LIMITE_LIVIANO` y la misma función                                                                           |
| Techo del bucket `clinical-exams`      | 200 MB                       | `storage.buckets.file_size_limit` (misma migración)                                                           |
| Límite global de archivos del proyecto | **200 MB** (ajuste del plan) | Supabase → Storage → Settings → _Global file size limit_. Gratis en el plan Pro; **se sube a mano**           |
| Cupo por clínica                       | 15 GB Solo / 45 GB Clínica   | `storage_quota_plans`                                                                                         |

El techo real de un archivo es el menor de los tres (función, bucket y límite global). Si alguien baja el global por debajo de 200 MB, las subidas grandes fallan con 413 y la app lo dice ("El servidor rechazó el archivo por su tamaño").

## Subida

- Hasta 6 MB: una sola petición (`uploadToSignedUrl`), como antes.
- Más de 6 MB: **subida reanudable** (protocolo TUS de Supabase Storage, `src/lib/examenes/subida-reanudable.ts`): trozos de 6 MB, progreso con tiempo restante, cancelar, reintento automático con espera creciente y espera a que vuelva internet, y consulta del desplazamiento real del servidor tras cada falla.
- Seguridad: usa **la misma firma** de subida (`createSignedUploadUrl`) que el servidor ya entregaba, en `/storage/v1/upload/resumable/sign`. Atada a una sola ruta con vencimiento de 2 h, sin service role en el navegador y sin políticas de storage nuevas. El servidor sigue reservando la fila (RLS y cupo en la base) y confirma el tamaño real al terminar.
- Si el servidor no ofrece TUS (404/405/501), se cae a la subida normal.
- Pestaña cerrada o corte largo: la reserva y la dirección de la subida quedan en `localStorage` (100 min). Al volver a elegir **el mismo archivo con los mismos datos** continúa desde el último trozo. Si no se retoma, `prepararSubidaExamen` libera las reservas de la clínica con más de 3 h antes de reservar la siguiente. Cancelar libera el cupo al instante.

## Visores

- Descarga con búfer único del tamaño declarado (sin duplicar memoria) y **reanudación con `Range`** si se corta.
- El parseo corre en un **Web Worker** (`visores.worker.ts`, se precalienta mientras baja el archivo): STL/PLY/OBJ se leen sin armar un texto gigante, el STL se suelda y las normales se calculan ahí, y el CBCT se descomprime **un corte a la vez** desde el ZIP (no se guarda el estudio entero descomprimido). La interfaz no se congela.
- Topes por equipo (`src/lib/visores/limites.ts`): computador 200 MB / 6 M triángulos / 100 M vóxeles; teléfono y tablet (táctil o ≤ 4 GB) 120 MB (texto 50 MB) / 3 M triángulos / 24 M vóxeles (el CBCT se muestra a media resolución). Sobre el tope, el visor lo explica y sugiere abrirlo en un computador.
- Formatos: el DICOM debe ir **sin comprimir** (Explicit/Implicit VR Little Endian); un CBCT subido como `.zip` se abre en el visor DICOM.

## Demo

`/api/demo-reset` siembra una arcada STL (1,8 MB), una arcada PLY con color (0,8 MB) y un CBCT sintético de 112 cortes (3 MB): `src/lib/visores/demo-3d.ts`.
