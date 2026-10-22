import { boxEfectivo } from "@/components/agenda-conflictos";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";

/**
 * Lógica pura de boxes (AGE-04 / ADM-06, Ola 2 · frente boxes y grilla):
 * el orden de la pantalla de Sucursales y los carriles de la agenda por box.
 */

/** Sube (-1) o baja (+1) un elemento. Fuera de rango, la lista queda igual. */
export function moverEnLista<T>(lista: readonly T[], indice: number, direccion: -1 | 1): T[] {
  const destino = indice + direccion;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) {
    return [...lista];
  }
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return copia;
}

/** Nombre de box válido para guardar: sin espacios de más, 1 a 60 caracteres. */
export function nombreDeBoxValido(nombre: string): string | null {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  return limpio.length >= 1 && limpio.length <= 60 ? limpio : null;
}

/** ¿Ya hay otro box con ese nombre en la sucursal? (sin mayúsculas ni espacios) */
export function nombreRepetido(
  nombre: string,
  boxes: readonly { id: string; name: string }[],
  exceptoId?: string,
): boolean {
  const clave = nombre.trim().replace(/\s+/g, " ").toLowerCase();
  return boxes.some((b) => b.id !== exceptoId && b.name.trim().toLowerCase() === clave);
}

export interface BoxDeAgenda {
  id: string;
  nombre: string;
  sucursalId: string;
}

/** Carril de la vista por box. `id` null = "Sin box". */
export interface CarrilDeBox {
  id: string | null;
  titulo: string;
  /** Sucursal del box, para el subtítulo cuando se ven varias. */
  sucursalId: string | null;
  citas: Cita[];
}

/**
 * Carriles de la agenda por box: uno por box activo (en el orden de la
 * sucursal), más "Sin box" si alguna cita no tiene box propio ni su
 * profesional uno por defecto. La cita va al carril de su box efectivo
 * (`boxEfectivo`): el suyo y, si no tiene, el del profesional. Una cita
 * cuyo box ya no está en la lista (desactivado) abre su propio carril con el
 * nombre guardado, para que ninguna cita quede sin dibujarse.
 */
export function carrilesPorBox({
  boxes,
  citas,
  profesionales,
}: {
  /** Boxes activos visibles (ya filtrados por sucursal), en orden. */
  boxes: readonly BoxDeAgenda[];
  /** Citas del día visibles. */
  citas: readonly Cita[];
  profesionales: readonly Pick<Profesional, "id" | "box" | "boxId">[];
}): CarrilDeBox[] {
  const porProfesional = new Map(profesionales.map((p) => [p.id, p]));
  const nombreDeBox = new Map(boxes.map((b) => [b.id, b.nombre]));
  const carriles = new Map<string, CarrilDeBox>(
    boxes.map((b) => [b.id, { id: b.id, titulo: b.nombre, sucursalId: b.sucursalId, citas: [] }]),
  );
  const extra = new Map<string, CarrilDeBox>();
  const sinBox: Cita[] = [];
  for (const c of citas) {
    const box = boxEfectivo(c, porProfesional.get(c.profesionalId), (id) => nombreDeBox.get(id));
    if (!box?.id) {
      sinBox.push(c);
      continue;
    }
    const carril = carriles.get(box.id) ?? extra.get(box.id);
    if (carril) {
      carril.citas.push(c);
    } else {
      extra.set(box.id, {
        id: box.id,
        titulo: box.nombre,
        sucursalId: c.sucursalId || null,
        citas: [c],
      });
    }
  }
  const lista = [...carriles.values(), ...extra.values()];
  if (sinBox.length > 0) {
    lista.push({ id: null, titulo: "Sin box", sucursalId: null, citas: sinBox });
  }
  return lista;
}
