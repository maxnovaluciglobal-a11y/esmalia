import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { conectar } from "./helpers/db";

/**
 * La migración del arqueo por denominación contra la base efímera de tests
 * (scripts/test-db/start.sh): columna jsonb nullable y el CHECK que solo deja
 * guardar el detalle en una caja cerrada.
 */
let client: Client;

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  await client?.end();
});

describe("cash_registers.closing_denominations", () => {
  it("es jsonb y admite NULL (los cierres viejos y los de 'Ingresar total')", async () => {
    const { rows } = await client.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_registers'
          AND column_name = 'closing_denominations'`,
    );
    expect(rows).toEqual([{ data_type: "jsonb", is_nullable: "YES" }]);
  });

  it("solo una caja cerrada lleva detalle, y el detalle es un objeto", async () => {
    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'cash_registers_closing_denominations_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/closing_denominations IS NULL/);
    expect(rows[0].def).toMatch(/status = 'closed'/);
    expect(rows[0].def).toMatch(/jsonb_typeof\(closing_denominations\) = 'object'/);
  });
});
