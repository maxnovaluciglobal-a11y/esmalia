import { describe, expect, it } from "vitest";

import { enBloques, leerTodasLasPaginas, mapConLimite } from "@/lib/paginacion";

/**
 * Prueba pura, sin base: simula PostgREST con un `max_rows` que corta cada
 * respuesta, como hace Supabase con 1000 filas.
 */
function tablaSimulada(total: number, maxRows: number) {
  const filas = Array.from({ length: total }, (_, i) => i);
  const pedidos: Array<[number, number]> = [];
  const pedir = (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    const pagina = filas.slice(desde, Math.min(hasta + 1, desde + maxRows));
    return Promise.resolve({ data: pagina, error: null });
  };
  return { pedir, pedidos };
}

describe("leerTodasLasPaginas", () => {
  it("junta todas las páginas aunque cada respuesta se corte en max_rows", async () => {
    const { pedir, pedidos } = tablaSimulada(2_345, 1_000);
    const r = await leerTodasLasPaginas(pedir);
    expect(r.filas).toHaveLength(2_345);
    expect(r.truncado).toBe(false);
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("con menos de una página hace un solo pedido", async () => {
    const { pedir, pedidos } = tablaSimulada(12, 1_000);
    const r = await leerTodasLasPaginas(pedir);
    expect(r.filas).toHaveLength(12);
    expect(pedidos).toHaveLength(1);
  });

  it("con tope, informa truncado solo si de verdad había más", async () => {
    const justo = await leerTodasLasPaginas(tablaSimulada(5_000, 1_000).pedir, { tope: 5_000 });
    expect(justo.filas).toHaveLength(5_000);
    expect(justo.truncado).toBe(false);

    const demas = await leerTodasLasPaginas(tablaSimulada(5_001, 1_000).pedir, { tope: 5_000 });
    expect(demas.filas).toHaveLength(5_000);
    expect(demas.truncado).toBe(true);
  });

  it("devuelve el error sin seguir pidiendo", async () => {
    let llamadas = 0;
    const r = await leerTodasLasPaginas(() => {
      llamadas += 1;
      return Promise.resolve({ data: null, error: { message: "permiso denegado" } });
    });
    expect(r.error?.message).toBe("permiso denegado");
    expect(llamadas).toBe(1);
  });
});

describe("enBloques y mapConLimite", () => {
  it("parte la lista sin perder ni repetir", () => {
    const bloques = enBloques(
      Array.from({ length: 450 }, (_, i) => i),
      200,
    );
    expect(bloques.map((b) => b.length)).toEqual([200, 200, 50]);
  });

  it("respeta el límite de tareas en vuelo y el orden del resultado", async () => {
    let enVuelo = 0;
    let maximo = 0;
    const r = await mapConLimite([5, 1, 4, 2, 3], 2, async (n) => {
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((ok) => setTimeout(ok, n));
      enVuelo -= 1;
      return n * 10;
    });
    expect(r).toEqual([50, 10, 40, 20, 30]);
    expect(maximo).toBe(2);
  });
});
