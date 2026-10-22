import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubTokensInEvent, scrubTokensInString } from "@/lib/sentry-redact";

// Auditoría 10-oct-2026: los portales sin login llevan el JWT en el path y
// los enlaces de Auth traen el token en la query. Nada de eso puede llegar a
// Sentry. Tokens sintéticos: no son firmas válidas de nada.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJwYXRpZW50X2lkIjoiYWJjIn0.c2lnbmF0dXJhLWZhbHNh";

describe("scrub de tokens antes de Sentry", () => {
  it("tapa el token del portal del paciente y del laboratorio", () => {
    expect(scrubTokensInString(`https://esmalia.com/portal/${JWT}`)).toBe(
      "https://esmalia.com/portal/[token]",
    );
    expect(scrubTokensInString(`/portal-laboratorio/${JWT}?x=1`)).toBe(
      "/portal-laboratorio/[token]?x=1",
    );
    // El segmento se tapa aunque no tenga forma de JWT.
    expect(scrubTokensInString("/portal/abc123")).toBe("/portal/[token]");
    // Firma a distancia (DOC-05): token opaco de 43 caracteres en el path.
    expect(
      scrubTokensInString("https://esmalia.com/firmar/Ab3_-Zx9Ab3_-Zx9Ab3_-Zx9Ab3_-Zx9Ab3_-Zx9Ab3"),
    ).toBe("https://esmalia.com/firmar/[token]");
  });

  it("tapa cualquier JWT suelto en un mensaje", () => {
    expect(scrubTokensInString(`Bearer ${JWT} rechazado`)).toBe("Bearer [token] rechazado");
  });

  it("tapa los parámetros sensibles de la query y del hash", () => {
    const url =
      "https://esmalia.com/auth/nueva-clave?token_hash=abc&type=recovery&code=xyz#access_token=aaa&refresh_token=bbb&expires_in=3600";
    const limpio = scrubTokensInString(url);
    expect(limpio).toBe(
      "https://esmalia.com/auth/nueva-clave?token_hash=[token]&type=recovery&code=[token]#access_token=[token]&refresh_token=[token]&expires_in=3600",
    );
    expect(scrubTokensInString("token=zzz&otro=1")).toBe("token=[token]&otro=1");
  });

  it("no toca URLs sin secretos", () => {
    const url = "https://esmalia.com/pacientes/123?pestana=notas";
    expect(scrubTokensInString(url)).toBe(url);
  });

  it("limpia request, transacción, breadcrumbs, tags y extra del evento", () => {
    const event = {
      message: `fallo en /portal/${JWT}`,
      transaction: `/portal/${JWT}`,
      request: {
        url: `https://esmalia.com/portal-laboratorio/${JWT}`,
        query_string: [
          ["code", "secreto"],
          ["pestana", "notas"],
        ],
        headers: { Referer: `https://esmalia.com/portal/${JWT}` },
      },
      breadcrumbs: [
        { message: `navegó a /portal/${JWT}`, data: { from: "/", to: `/portal/${JWT}` } },
      ],
      tags: { ruta: `/portal/${JWT}` },
      extra: { refresh_token: "r", code: "23505" },
      exception: { values: [{ value: `token=${JWT}` }] },
    };
    scrubTokensInEvent(event);
    const serializado = JSON.stringify(event);
    expect(serializado).not.toContain(JWT);
    expect(serializado).not.toContain("secreto");
    expect(event.request.query_string).toEqual([
      ["code", "[token]"],
      ["pestana", "notas"],
    ]);
    expect(event.extra).toEqual({ refresh_token: "[token]", code: "23505" });
    expect(event.tags.ruta).toBe("/portal/[token]");
  });

  it("limpia breadcrumbs de fetch", () => {
    const b = scrubBreadcrumb({
      data: { url: `/_serverFn/x?token=${JWT}`, method: "GET", status_code: 500 },
    });
    expect(b.data).toEqual({ url: "/_serverFn/x?token=[token]", method: "GET", status_code: 500 });
  });
});
