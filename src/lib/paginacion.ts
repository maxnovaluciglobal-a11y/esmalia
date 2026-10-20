// Lecturas que no se cortan en silencio.
//
// PostgREST corta toda respuesta en `max_rows` (1000 en Supabase) aunque se
// pida `.limit(5000)`: la respuesta llega con 1000 filas y sin error. Un tope
// mayor a eso en una sola consulta nunca se alcanzaba y el `truncated` que lo
// vigilaba nunca se encendía (auditoría de rendimiento, 20-oct-2026). Acá se
// lee de a páginas con `.range()` hasta terminar o hasta el tope pedido.

/** Filas por página: el `max_rows` de PostgREST en Supabase. */
export const FILAS_POR_PAGINA = 1000;

/**
 * Ids por bloque en un `.in()`: cada uuid ocupa ~37 caracteres en la URL, y
 * con miles de ids el pedido excede el largo máximo de URL del gateway.
 */
export const IDS_POR_BLOQUE = 200;

/** Lo mínimo de un `PostgrestError` que usan `mensajeDb` y los logs. */
export interface ErrorDeLectura {
  message: string;
  code?: string;
}

export interface LecturaPaginada<T> {
  filas: T[];
  /** true si había más filas que el tope pedido (se devuelven las primeras `tope`). */
  truncado: boolean;
  error: ErrorDeLectura | null;
}

/**
 * Lee todas las páginas de una consulta. `pedirPagina(desde, hasta)` arma la
 * consulta con un orden ESTABLE (si no, una fila puede repetirse o perderse
 * entre páginas) y le aplica `.range(desde, hasta)`.
 *
 * Termina cuando una página vuelve con menos filas de las pedidas. Supone que
 * `max_rows` del proyecto es al menos FILAS_POR_PAGINA (el default de
 * Supabase); si alguien lo bajara, hay que bajar también esta constante.
 *
 * Con `tope`, pide una fila de más para saber si hay más de `tope` y así
 * informar `truncado` de verdad, no por coincidir con el número redondo.
 */
export async function leerTodasLasPaginas<T>(
  pedirPagina: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: ErrorDeLectura | null }>,
  opciones: { tope?: number; porPagina?: number } = {},
): Promise<LecturaPaginada<T>> {
  const porPagina = opciones.porPagina ?? FILAS_POR_PAGINA;
  const tope = opciones.tope;
  const filas: T[] = [];
  for (let desde = 0; ;) {
    let hasta = desde + porPagina - 1;
    // Índice `tope` = la fila número tope+1: la que delata que hay más.
    if (tope !== undefined) hasta = Math.min(hasta, tope);
    const { data, error } = await pedirPagina(desde, hasta);
    if (error) return { filas, truncado: false, error };
    const pagina = data ?? [];
    filas.push(...pagina);
    if (tope !== undefined && filas.length > tope) {
      return { filas: filas.slice(0, tope), truncado: true, error: null };
    }
    if (pagina.length < hasta - desde + 1) break;
    desde += pagina.length;
  }
  return { filas, truncado: false, error: null };
}

/** Parte una lista en bloques de `tamano`. */
export function enBloques<T>(lista: readonly T[], tamano: number = IDS_POR_BLOQUE): T[][] {
  const bloques: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) bloques.push(lista.slice(i, i + tamano));
  return bloques;
}

/**
 * `Promise.all` con a lo sumo `limite` tareas en vuelo, y el resultado en el
 * mismo orden que la entrada. Para no abrir cientos de requests a la vez
 * contra Supabase cuando se reemplaza un bucle de `await` uno por uno.
 */
export async function mapConLimite<T, R>(
  lista: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => PromiseLike<R>,
): Promise<R[]> {
  const resultados = new Array<R>(lista.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < lista.length) {
      const i = siguiente++;
      resultados[i] = await fn(lista[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, trabajador));
  return resultados;
}
