// Lógica pura: no toca la base ni la red (fetch y el navegador van con mocks).
// Tracking plan del embudo — docs/MEDICION.md, src/lib/marketing/medicion.ts.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENTOS_CLIENTE,
  EVENTOS_DEL_PLAN,
  esAltaReciente,
  esCorreoInterno,
  esNavegadorInterno,
  esRutaMedible,
  horasDesdeAlta,
  hostDeReferrer,
  normalizarRuta,
  paisDeCabecera,
  propsDeVista,
  suscripcionConfirmada,
  utmDeBusqueda,
} from "@/lib/marketing/medicion";

const DIR_MIGRACIONES = new URL("../supabase/migrations/", import.meta.url);

/** Nombres del CHECK `marketing_events_name_valido` en la última migración que lo define. */
function nombresDelCheck(): string[] {
  const archivos = readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let ultimo = "";
  for (const f of archivos) {
    const sql = readFileSync(new URL(f, DIR_MIGRACIONES), "utf8");
    if (
      /add constraint marketing_events_name_valido|constraint marketing_events_name_valido\s+check/i.test(
        sql,
      )
    )
      ultimo = sql;
  }
  const sinComentarios = ultimo.replace(/--.*$/gm, "");
  const bloque = sinComentarios.slice(sinComentarios.lastIndexOf("marketing_events_name_valido"));
  const lista = bloque.slice(bloque.indexOf("in ("), bloque.indexOf(")"));
  return [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("tracking plan", () => {
  it("el CHECK de la base y EVENTOS_DEL_PLAN tienen los mismos nombres", () => {
    expect(new Set(nombresDelCheck())).toEqual(new Set(EVENTOS_DEL_PLAN));
  });

  it("no hay nombres repetidos", () => {
    expect(new Set(EVENTOS_DEL_PLAN).size).toBe(EVENTOS_DEL_PLAN.length);
  });

  it("cada evento está documentado en docs/MEDICION.md", () => {
    const doc = readFileSync(new URL("../docs/MEDICION.md", import.meta.url), "utf8");
    for (const nombre of EVENTOS_DEL_PLAN) expect(doc).toContain("`" + nombre + "`");
  });

  it("/api/ev solo acepta eventos anónimos del navegador", () => {
    const api = readFileSync(new URL("../src/routes/api.ev.ts", import.meta.url), "utf8");
    expect(api).toContain("z.enum(EVENTOS_CLIENTE)");
    for (const n of ["registro_completado", "suscripcion_activada", "primera_cita_creada"]) {
      expect(EVENTOS_CLIENTE as readonly string[]).not.toContain(n);
    }
  });
});

describe("esRutaMedible", () => {
  it.each([
    "/",
    "/precios",
    "/precios/",
    "/auth",
    "/demo",
    "/funciones",
    "/funciones/agenda-dental",
    "/comparar/esmalia-vs-dentalink",
    "/software-dental-chile",
    "/calculadora-rentabilidad-dental",
    "/recorrido",
  ])("mide %s", (ruta) => expect(esRutaMedible(ruta)).toBe(true));

  it.each([
    "/portal/eyJhbGciOiJIUzI1NiJ9.token",
    "/portal-laboratorio/abc123",
    "/dashboard",
    "/agenda",
    "/pacientes/d8db4f25-c160-4394-938a-3076282f66c4",
    "/admin/leads",
    "/auth/nueva-clave",
    "/funcionesx",
    "/api/ev",
  ])("no mide %s", (ruta) => expect(esRutaMedible(ruta)).toBe(false));
});

describe("normalizarRuta", () => {
  it("quita query, hash y barra final y recorta a 60", () => {
    expect(normalizarRuta("/precios/?x=1#y")).toBe("/precios");
    expect(normalizarRuta("/")).toBe("/");
    expect(normalizarRuta("/guias/" + "a".repeat(100)).length).toBe(60);
  });
});

describe("hostDeReferrer", () => {
  it("devuelve solo el dominio, sin www", () => {
    expect(hostDeReferrer("https://www.google.com/search?q=software+dental", "esmalia.com")).toBe(
      "google.com",
    );
    expect(
      hostDeReferrer("https://l.instagram.com/?u=https%3A%2F%2Fesmalia.com", "esmalia.com"),
    ).toBe("l.instagram.com");
  });

  it("null si no hay referrer, es inválido o es el propio sitio", () => {
    expect(hostDeReferrer("", "esmalia.com")).toBeNull();
    expect(hostDeReferrer("no es una url", "esmalia.com")).toBeNull();
    expect(hostDeReferrer("https://esmalia.com/precios", "esmalia.com")).toBeNull();
    expect(hostDeReferrer("https://www.esmalia.com/", "esmalia.com")).toBeNull();
    expect(hostDeReferrer("http://localhost:8080/", "localhost")).toBeNull();
  });
});

describe("utmDeBusqueda", () => {
  it("lee las tres utm, en minúsculas y recortadas", () => {
    expect(
      utmDeBusqueda("?utm_source=WhatsApp&utm_medium=outbound&utm_campaign=outbound-cl&otro=1"),
    ).toEqual({ utm_source: "whatsapp", utm_medium: "outbound", utm_campaign: "outbound-cl" });
    expect(utmDeBusqueda("?utm_campaign=" + "x".repeat(200)).utm_campaign).toHaveLength(60);
  });

  it("descarta valores vacíos o con @ (un email pegado en el enlace)", () => {
    expect(utmDeBusqueda("?utm_source=&utm_medium=%20&utm_campaign=ana%40clinica.cl")).toEqual({});
    expect(utmDeBusqueda("")).toEqual({});
  });
});

describe("propsDeVista", () => {
  const base = {
    pathname: "/precios",
    search: "?utm_source=google&utm_medium=cpc&gclid=abc",
    referrer: "https://www.google.com/",
    hostPropio: "esmalia.com",
  };

  it("la vista de entrada lleva el origen", () => {
    expect(propsDeVista({ ...base, esEntrada: true })).toEqual({
      path: "/precios",
      entrada: true,
      ref_host: "google.com",
      utm_source: "google",
      utm_medium: "cpc",
    });
  });

  it("sin referrer externo la entrada es 'directo'", () => {
    expect(propsDeVista({ ...base, search: "", referrer: "", esEntrada: true })).toEqual({
      path: "/precios",
      entrada: true,
      ref_host: "directo",
    });
  });

  it("las vistas siguientes llevan solo la ruta (en una SPA el referrer no cambia)", () => {
    expect(propsDeVista({ ...base, esEntrada: false })).toEqual({ path: "/precios" });
  });

  it("nunca manda la URL completa ni parámetros que no son utm", () => {
    const json = JSON.stringify(propsDeVista({ ...base, esEntrada: true }));
    expect(json).not.toContain("gclid");
    expect(json).not.toContain("https://");
  });
});

describe("tráfico interno", () => {
  const STAFF = "walter@esmalia.com, Equipo@Esmalia.com";

  it.each([
    ["walter@esmalia.com", true],
    ["EQUIPO@esmalia.com", true],
    ["demo@esmalia.com", true],
    ["finview-owner-1@esmalia-test.invalid", true],
    ["prueba@clinica.test", true],
    ["qa-x@example.com", true],
    ["dra.perez@gmail.com", false],
    ["contacto@clinicadental.cl", false],
    ["", false],
  ])("esCorreoInterno(%s) = %s", (email, esperado) => {
    expect(esCorreoInterno(email, STAFF, "demo@esmalia.com")).toBe(esperado);
  });

  it("sin allowlist configurada solo marca demo y dominios de prueba", () => {
    expect(esCorreoInterno("walter@esmalia.com", undefined, "demo@esmalia.com")).toBe(false);
    expect(esCorreoInterno(null, "", "demo@esmalia.com")).toBe(false);
  });

  it("navegador: cualquier señal lo marca", () => {
    expect(esNavegadorInterno({ qa: false, webdriver: false, equipo: false })).toBe(false);
    expect(esNavegadorInterno({ qa: true, webdriver: false, equipo: false })).toBe(true);
    expect(esNavegadorInterno({ qa: false, webdriver: true, equipo: false })).toBe(true);
    expect(esNavegadorInterno({ qa: false, webdriver: false, equipo: true })).toBe(true);
  });
});

describe("validaciones del servidor", () => {
  const ahora = new Date("2026-10-19T15:00:00Z");

  it("esAltaReciente: solo cuentas creadas en los últimos 30 min", () => {
    expect(esAltaReciente("2026-10-19T14:45:00Z", ahora)).toBe(true);
    expect(esAltaReciente("2026-10-19T14:00:00Z", ahora)).toBe(false);
    expect(esAltaReciente("2025-01-01T00:00:00Z", ahora)).toBe(false);
    expect(esAltaReciente(null, ahora)).toBe(false);
    expect(esAltaReciente("basura", ahora)).toBe(false);
    // Reloj del cliente/servidor un poco corrido: hasta 1 min "en el futuro".
    expect(esAltaReciente("2026-10-19T15:00:30Z", ahora)).toBe(true);
    expect(esAltaReciente("2026-10-19T15:10:00Z", ahora)).toBe(false);
  });

  it("horasDesdeAlta: horas enteras y ventana de 72 h", () => {
    expect(horasDesdeAlta("2026-10-19T12:30:00Z", ahora)).toEqual({
      horas_desde_alta: "2",
      dentro_72h: true,
    });
    expect(horasDesdeAlta("2026-10-15T15:00:00Z", ahora)).toEqual({
      horas_desde_alta: "96",
      dentro_72h: false,
    });
    expect(horasDesdeAlta(null, ahora)).toBeNull();
  });

  it("paisDeCabecera: dos letras o nada", () => {
    expect(paisDeCabecera("cl")).toBe("CL");
    expect(paisDeCabecera("MX")).toBe("MX");
    expect(paisDeCabecera("")).toBeNull();
    expect(paisDeCabecera(null)).toBeNull();
    expect(paisDeCabecera("190.22.1.1")).toBeNull();
  });

  it("suscripcionConfirmada: el trial del alta (sin Stripe) no cuenta", () => {
    expect(suscripcionConfirmada({ status: "trialing", stripe_subscription_id: null })).toBe(false);
    expect(suscripcionConfirmada({ status: "trialing", stripe_subscription_id: "sub_1" })).toBe(
      true,
    );
    expect(suscripcionConfirmada({ status: "active", stripe_subscription_id: "sub_1" })).toBe(true);
    expect(suscripcionConfirmada({ status: "canceled", stripe_subscription_id: "sub_1" })).toBe(
      false,
    );
    expect(suscripcionConfirmada(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cliente (eventos.ts) con un navegador falso: qué sale por la red.
// ---------------------------------------------------------------------------

function almacen(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("eventos.ts en el navegador", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let session: Storage;
  let local: Storage;

  function navegador(url: string, referrer = "", webdriver = false) {
    const u = new URL(url);
    vi.stubGlobal("window", {
      location: { search: u.search, hostname: u.hostname, pathname: u.pathname },
      sessionStorage: session,
      localStorage: local,
    });
    vi.stubGlobal("document", { referrer });
    vi.stubGlobal("navigator", { webdriver });
  }

  function enviados(): Array<{
    name: string;
    props?: Record<string, unknown>;
    sessionHash: string;
  }> {
    return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
  }

  beforeEach(() => {
    vi.resetModules();
    session = almacen();
    local = almacen();
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("entrada con origen, luego solo ruta, misma sesión y sin cookies", async () => {
    navegador(
      "https://esmalia.com/?utm_source=whatsapp&utm_campaign=outbound-cl",
      "https://wa.me/",
    );
    const ev = await import("@/lib/marketing/eventos");
    ev.registrarVistaDePagina("/");
    ev.registrarVistaDePagina("/"); // re-render: no duplica
    ev.registrarVistaDePagina("/precios");
    ev.registrarVistaDePagina("/dashboard"); // app: no se mide

    const [a, b, ...resto] = enviados();
    expect(resto).toHaveLength(0);
    expect(a.name).toBe("page_view");
    expect(a.props).toEqual({
      path: "/",
      entrada: true,
      ref_host: "wa.me",
      utm_source: "whatsapp",
      utm_campaign: "outbound-cl",
    });
    expect(b.props).toEqual({ path: "/precios" });
    expect(a.sessionHash).toMatch(/^[0-9a-f]{32}$/);
    expect(b.sessionHash).toBe(a.sessionHash);
    expect(session.getItem("esmalia:ev-sesion")).toBe(a.sessionHash);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ev");
    expect(JSON.stringify((fetchMock.mock.calls[0][1] as RequestInit).headers)).not.toMatch(
      /cookie/i,
    );
  });

  it("la sesión sobrevive a recargar el módulo (vuelta de Google/Stripe en la misma pestaña)", async () => {
    navegador("https://esmalia.com/");
    const ev1 = await import("@/lib/marketing/eventos");
    const h1 = ev1.hashDeSesion();
    vi.resetModules();
    const ev2 = await import("@/lib/marketing/eventos");
    expect(ev2.hashDeSesion()).toBe(h1);
  });

  it("?qa=1 marca interno toda la pestaña; ?qa=0 lo apaga", async () => {
    navegador("https://esmalia.com/precios?qa=1");
    const ev = await import("@/lib/marketing/eventos");
    ev.registrarEvento("cta_click", { cta: "demo", lugar: "nav" });
    navegador("https://esmalia.com/funciones");
    ev.registrarEvento("cta_click", { cta: "demo", lugar: "nav" });
    navegador("https://esmalia.com/funciones?qa=0");
    ev.registrarEvento("cta_click", { cta: "demo", lugar: "nav" });

    const [a, b, c] = enviados();
    expect(a.props?.interno).toBe(true);
    expect(b.props?.interno).toBe(true);
    expect(c.props?.interno).toBeUndefined();
  });

  it("navegador automatizado y equipo del staff quedan como internos", async () => {
    navegador("https://esmalia.com/", "", true);
    const ev = await import("@/lib/marketing/eventos");
    ev.registrarEvento("cta_click");
    navegador("https://esmalia.com/");
    ev.marcarEquipoInterno();
    ev.registrarEvento("cta_click");

    const [a, b] = enviados();
    expect(a.props?.interno).toBe(true);
    expect(b.props?.interno).toBe(true);
    expect(local.getItem("esmalia:medicion-interna")).toBe("1");
  });

  it("nunca rompe la página aunque el storage esté bloqueado o fetch falle", async () => {
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    session = roto;
    local = roto;
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    navegador("https://esmalia.com/");
    const ev = await import("@/lib/marketing/eventos");
    expect(() => ev.registrarVistaDePagina("/")).not.toThrow();
    expect(enviados()[0].sessionHash).toMatch(/^[0-9a-f]{32}$/);
  });
});
