import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Revisión final de rama — Critical #1: `listPaymentMethods`, `listAgreements`
 * e `listInventoryItems` tenían el gate de trial de Task 11
 * (`throwIfTrialBlocksInformes`) INCONDICIONAL, pero las tres también las
 * llaman pantallas operativas que están en `ABIERTO_SIEMPRE`
 * (`finance-section.tsx` en `/pacientes/:id`, el selector de convenio en la
 * misma ficha, y `RecetaDialog` en `/aranceles`) — nunca deben gatearse
 * (regla no-negociable #3). El fallo era silencioso: nadie capturaba el
 * error, la lista caía a `[]`, y en `finance-section.tsx` eso hacía que
 * `registerPayment` recibiera `paymentMethodId: undefined`, omitiendo la
 * retención del medio de pago sin avisar a nadie.
 *
 * El fix desacopla el gate de la función compartida: ahora es un flag
 * explícito `paraInforme` que solo pasan las 3 pantallas de INFORME
 * (`/medios-de-pago`, `/convenios`, `/inventario`).
 *
 * No se puede probar esto invocando las funciones directamente: son
 * `createServerFn(...)` y su middleware `requireSupabaseAuth` llama a
 * `getRequest()` de `@tanstack/react-start/server`, que exige un request HTTP
 * real (ver el comentario de `tests/finance-reports-permission.test.ts`, que
 * documenta el mismo límite para las 5 funciones que Task 11 gateó). Este
 * test ancla en el código fuente lo que sí se puede verificar sin ese
 * contexto: que el gate es condicional en el handler, y que cada caller pasa
 * (o no pasa) el flag correcto. La verificación de comportamiento real —que
 * con trial vencido `/pacientes/:id` sigue mostrando medios de pago mientras
 * `/medios-de-pago` gatea— se hizo a mano contra un dev server real (ver
 * final-review-fix-report.md).
 */

function leer(rutaRelativa: string): string {
  return readFileSync(new URL(`../${rutaRelativa}`, import.meta.url), "utf8");
}

/**
 * Extrae el cuerpo de un `export const <nombre> = createServerFn(...)` hasta
 * el próximo `export const` (o fin de archivo) — suficiente para inspeccionar
 * su `.validator` y su `.handler` sin un parser de TS real.
 */
function cuerpoDeFuncion(fuente: string, nombre: string): string {
  const inicio = fuente.indexOf(`export const ${nombre} = createServerFn(`);
  if (inicio === -1) throw new Error(`No se encontró "export const ${nombre} = createServerFn("`);
  const resto = fuente.slice(inicio + 1);
  const siguiente = resto.search(/\nexport const /);
  return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

const CLINIC_FINANCE = "src/lib/finance/clinic-finance.functions.ts";
const INVENTORY = "src/lib/clinic-operations/inventory.functions.ts";
const CLINIC_OPERATIONS = "src/lib/clinic-operations/clinic-operations.functions.ts";

describe("gate de trial opt-in (paraInforme) — listPaymentMethods/listAgreements/listInventoryItems", () => {
  it.each([
    ["listPaymentMethods", CLINIC_FINANCE],
    ["listAgreements", CLINIC_FINANCE],
    ["listInventoryItems", INVENTORY],
  ])("%s declara paraInforme en su schema Zod, con default false", (nombre, archivo) => {
    const cuerpo = cuerpoDeFuncion(leer(archivo), nombre as string);
    expect(cuerpo).toMatch(/paraInforme:\s*z\.boolean\(\)\.default\(false\)/);
  });

  it.each([
    ["listPaymentMethods", CLINIC_FINANCE],
    ["listAgreements", CLINIC_FINANCE],
    ["listInventoryItems", INVENTORY],
  ])(
    "%s solo llama throwIfTrialBlocksInformes cuando data.paraInforme es true",
    (nombre, archivo) => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), nombre as string);
      // El gate tiene que estar condicionado al flag — nunca incondicional,
      // que es exactamente el bug que este fix corrige.
      expect(cuerpo).toMatch(/if\s*\(\s*data\.paraInforme\s*\)\s*await throwIfTrialBlocksInformes/);
      // No debe quedar el llamado viejo (incondicional) en paralelo.
      const llamadosIncondicionales = (
        cuerpo.match(/(?<!if \(data\.paraInforme\)\s)await throwIfTrialBlocksInformes/g) ?? []
      ).length;
      expect(llamadosIncondicionales).toBe(0);
    },
  );

  it("listExpenses y listLabOrders NO tienen paraInforme — no tienen callers operativos fuera de su propia pantalla de informe (/gastos, /laboratorios), así que su gate sigue incondicional", () => {
    const gastos = cuerpoDeFuncion(leer(CLINIC_FINANCE), "listExpenses");
    expect(gastos).toMatch(
      /await throwIfTrialBlocksInformes\(context\.supabase, data\.clinicId\);/,
    );
    expect(gastos).not.toMatch(/paraInforme/);

    const laboratorios = cuerpoDeFuncion(leer(CLINIC_OPERATIONS), "listLabOrders");
    expect(laboratorios).toMatch(/await throwIfTrialBlocksInformes\(supabase, data\.clinicId\);/);
    expect(laboratorios).not.toMatch(/paraInforme/);
  });

  it.each([
    ["src/routes/_authenticated/_clinic/medios-de-pago.tsx", "fetchMethods"],
    ["src/routes/_authenticated/_clinic/convenios.tsx", "fetchAgreements"],
    ["src/routes/_authenticated/_clinic/inventario.tsx", "fetchItems"],
  ])("la pantalla de informe %s pasa paraInforme: true", (archivo) => {
    const fuente = leer(archivo);
    expect(fuente).toMatch(/paraInforme:\s*true/);
  });

  it.each([
    ["src/components/finance-section.tsx", "listPaymentMethods"],
    ["src/routes/_authenticated/_clinic/pacientes.$pacienteId.tsx", "listAgreements"],
    ["src/routes/_authenticated/_clinic/aranceles.tsx", "listInventoryItems"],
  ])("el caller operativo %s (ABIERTO_SIEMPRE) NO pasa paraInforme — nunca se gatea", (archivo) => {
    const fuente = leer(archivo);
    expect(fuente).not.toMatch(/paraInforme/);
  });
});
