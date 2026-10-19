import { describe, expect, it } from "vitest";
import guardProduccion, { variablesHaciaProduccion } from "./setup/guard-produccion";

describe("guardia de producción de la suite", () => {
  it("deja pasar la base local efímera", () => {
    expect(
      variablesHaciaProduccion({
        SUPABASE_URL: "http://127.0.0.1:54321",
        PGHOST: "127.0.0.1",
        PGUSER: "postgres",
      }),
    ).toEqual([]);
  });

  it("detecta el ref de producción en SUPABASE_URL", () => {
    expect(
      variablesHaciaProduccion({ SUPABASE_URL: "https://hvfkygoguxvpmwslrccb.supabase.co" }),
    ).toEqual([{ variable: "SUPABASE_URL", patron: "hvfkygoguxvpmwslrccb" }]);
  });

  it("detecta el pooler de Supabase en PGHOST y el ref en PGUSER", () => {
    const hallazgos = variablesHaciaProduccion({
      PGHOST: "aws-0-sa-east-1.pooler.supabase.com",
      PGUSER: "postgres.hvfkygoguxvpmwslrccb",
    });
    expect(hallazgos.map((h) => h.variable)).toEqual(["PGHOST", "PGUSER"]);
  });

  it("no distingue mayúsculas", () => {
    expect(
      variablesHaciaProduccion({ DATABASE_URL: "postgres://X@AWS-0.POOLER.SUPABASE.COM" }),
    ).toHaveLength(1);
  });

  it("aborta la corrida con un mensaje claro", () => {
    const original = process.env.PGHOST;
    process.env.PGHOST = "db.hvfkygoguxvpmwslrccb.supabase.co";
    try {
      expect(() => guardProduccion()).toThrow(/PRODUCCIÓN[\s\S]*PGHOST/);
    } finally {
      if (original === undefined) delete process.env.PGHOST;
      else process.env.PGHOST = original;
    }
  });
});
