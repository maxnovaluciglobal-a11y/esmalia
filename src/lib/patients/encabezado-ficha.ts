/**
 * Encabezado editorial de la ficha (A+, 26-oct-2026): nombre en dos tiempos
 * y documento enmascarado. Lógica pura, con test en `tests/encabezado-ficha.test.ts`.
 */

/**
 * Parte el nombre como lo muestra el prototipo A+: el primer nombre en
 * redonda y los apellidos en itálica ocre ("Martina *Soto Pérez*"). Con una
 * sola palabra no hay segunda parte.
 */
export function partirNombre(nombre: string): { primero: string; resto: string } {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return { primero: partes[0] ?? "", resto: "" };
  return { primero: partes[0], resto: partes.slice(1).join(" ") };
}

/**
 * Documento enmascarado para el encabezado, que se ve desde la recepción y
 * en pantallas compartidas: se ocultan los dígitos salvo los últimos tres
 * del número y el dígito verificador ("15.789.012-3" → "••.•••.012-3").
 * Se conservan puntos y guion para que se siga leyendo como un RUT. Un
 * documento corto (4 caracteres o menos) se muestra tal cual: enmascararlo
 * no esconde nada y lo vuelve ilegible.
 */
export function enmascararDocumento(documento: string): string {
  const doc = documento.trim();
  if (!doc) return "";
  const alfanumericos = doc.replace(/[^0-9a-z]/gi, "");
  if (alfanumericos.length <= 4) return doc;
  // Se ven los últimos 4 alfanuméricos (3 del número + verificador).
  let visibles = 4;
  let salida = "";
  for (let i = doc.length - 1; i >= 0; i--) {
    const c = doc[i];
    if (/[0-9a-z]/i.test(c)) {
      salida = (visibles > 0 ? c : "•") + salida;
      visibles--;
    } else {
      salida = c + salida;
    }
  }
  return salida;
}
