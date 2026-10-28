import { describe, expect, it } from "vitest";

import {
  ErrorDeSubida,
  MAX_SUBIDA_SIMPLE,
  TAMANO_TROZO,
  esperaPorDefecto,
  subirReanudable,
  terminarSubida,
  type PeticionTus,
  type RespuestaTus,
  type Transporte,
} from "../src/lib/examenes/subida-reanudable";

/**
 * Subida reanudable (TUS): se prueba contra un servidor falso en memoria que
 * habla el protocolo igual que Supabase Storage (POST crea, HEAD dice el
 * desplazamiento, PATCH exige el desplazamiento exacto y trozos de 6 MB).
 */

const MB = 1024 * 1024;

function respuesta(status: number, cabeceras: Record<string, string> = {}): RespuestaTus {
  const m = new Map(Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, encabezado: (n) => m.get(n.toLowerCase()) ?? null };
}

interface Plan {
  /** Número de PATCH (desde 1) → qué le pasa. */
  patch?: Record<number, "red-antes" | "red-despues" | "500" | "409">;
  crear?: number;
  head?: number;
}

function servidorFalso(plan: Plan = {}) {
  const subidas = new Map<string, { largo: number; recibido: number; trozos: number[] }>();
  const bitacora: { metodo: string; offset?: string }[] = [];
  let nPatch = 0;
  let nSubida = 0;
  const transporte: Transporte = async (p: PeticionTus) => {
    bitacora.push({ metodo: p.metodo, offset: p.encabezados["Upload-Offset"] });
    if (p.senal?.aborted) throw new ErrorDeSubida("cancelada", "x");
    if (p.metodo === "POST") {
      if (plan.crear) return respuesta(plan.crear);
      const id = `http://tus.test/sign/${++nSubida}`;
      subidas.set(id, { largo: Number(p.encabezados["Upload-Length"]), recibido: 0, trozos: [] });
      return respuesta(201, { Location: id });
    }
    const s = subidas.get(p.url);
    if (p.metodo === "HEAD") {
      if (plan.head) return respuesta(plan.head);
      if (!s) return respuesta(404);
      return respuesta(200, {
        "Upload-Offset": String(s.recibido),
        "Upload-Length": String(s.largo),
      });
    }
    if (p.metodo === "DELETE") {
      subidas.delete(p.url);
      return respuesta(204);
    }
    nPatch += 1;
    const falla = plan.patch?.[nPatch];
    if (!s) return respuesta(404);
    if (falla === "red-antes") throw new TypeError("Fallo de red");
    if (falla === "500") return respuesta(500);
    if (falla === "409") return respuesta(409);
    const offset = Number(p.encabezados["Upload-Offset"]);
    if (offset !== s.recibido) return respuesta(409);
    const largo = p.cuerpo?.size ?? 0;
    // Supabase exige trozos de 6 MB salvo el último.
    if (offset + largo < s.largo && largo !== TAMANO_TROZO) return respuesta(400);
    p.alProgreso?.(largo);
    s.recibido += largo;
    s.trozos.push(largo);
    if (falla === "red-despues") throw new TypeError("Fallo de red (la respuesta se perdió)");
    return respuesta(204, { "Upload-Offset": String(s.recibido) });
  };
  return { transporte, subidas, bitacora };
}

const sinEspera = {
  esperaMs: () => 0,
  dormir: async () => {},
  esperarConexion: async () => {},
};

function base(archivo: Blob, transporte: Transporte, extra: object = {}) {
  return {
    endpoint: "http://tus.test/sign",
    apikey: "clave-publica",
    firma: "firma",
    bucket: "clinical-exams",
    objeto: "c/p/e/ct.zip",
    contentType: "application/zip",
    archivo,
    transporte,
    ...sinEspera,
    ...extra,
  };
}

describe("constantes", () => {
  it("el trozo es de 6 MB y por debajo se usa la subida simple", () => {
    expect(TAMANO_TROZO).toBe(6 * MB);
    expect(MAX_SUBIDA_SIMPLE).toBe(TAMANO_TROZO);
  });
  it("la espera crece 1, 2, 4… hasta 15 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(esperaPorDefecto)).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
  });
});

describe("subirReanudable", () => {
  it("sube en trozos de 6 MB y avisa el progreso sin retroceder", async () => {
    const { transporte, subidas } = servidorFalso();
    const avances: number[] = [];
    await subirReanudable(
      base(new Blob([new Uint8Array(20 * MB)]), transporte, {
        alProgreso: (n: number, total: number) => {
          expect(total).toBe(20 * MB);
          avances.push(n);
        },
      }),
    );
    const [u] = [...subidas.values()];
    expect(u.recibido).toBe(20 * MB);
    expect(u.trozos).toEqual([6 * MB, 6 * MB, 6 * MB, 2 * MB]);
    expect(avances[0]).toBe(0);
    expect(avances.at(-1)).toBe(20 * MB);
    expect([...avances].sort((a, b) => a - b)).toEqual(avances);
  });

  it("manda la firma y la clave, y los metadatos del objeto en base64", async () => {
    const vistos: PeticionTus[] = [];
    const { transporte } = servidorFalso();
    await subirReanudable(
      base(new Blob([new Uint8Array(1 * MB)]), (p) => (vistos.push(p), transporte(p))),
    );
    const crear = vistos.find((p) => p.metodo === "POST")!;
    expect(crear.encabezados["x-signature"]).toBe("firma");
    expect(crear.encabezados.apikey).toBe("clave-publica");
    expect(crear.encabezados["Upload-Length"]).toBe(String(1 * MB));
    const meta = Object.fromEntries(
      crear.encabezados["Upload-Metadata"].split(",").map((par) => {
        const [k, v] = par.split(" ");
        return [k, Buffer.from(v, "base64").toString("utf8")];
      }),
    );
    expect(meta).toMatchObject({
      bucketName: "clinical-exams",
      objectName: "c/p/e/ct.zip",
      contentType: "application/zip",
    });
    // Nunca la clave de servicio: solo la pública y la firma de este objeto.
    expect(JSON.stringify(vistos.map((p) => p.encabezados))).not.toMatch(/service_role/i);
  });

  it("si se corta la conexión a mitad, consulta el desplazamiento y sigue", async () => {
    const { transporte, subidas, bitacora } = servidorFalso({ patch: { 2: "red-antes" } });
    const reintentos: number[] = [];
    await subirReanudable(
      base(new Blob([new Uint8Array(20 * MB)]), transporte, {
        alReintento: (i: { intento: number }) => reintentos.push(i.intento),
      }),
    );
    expect([...subidas.values()][0].recibido).toBe(20 * MB);
    expect(reintentos).toEqual([1]);
    expect(bitacora.filter((b) => b.metodo === "HEAD")).toHaveLength(1);
  });

  it("si el trozo llegó pero se perdió la respuesta, no lo manda dos veces", async () => {
    const { transporte, subidas } = servidorFalso({ patch: { 1: "red-despues" } });
    await subirReanudable(base(new Blob([new Uint8Array(14 * MB)]), transporte));
    const [u] = [...subidas.values()];
    expect(u.recibido).toBe(14 * MB);
    expect(u.trozos).toEqual([6 * MB, 6 * MB, 2 * MB]);
  });

  it("reintenta ante un 500 y ante un 409 (desfase) y termina", async () => {
    const { transporte, subidas } = servidorFalso({ patch: { 1: "500", 3: "409" } });
    await subirReanudable(base(new Blob([new Uint8Array(13 * MB)]), transporte));
    expect([...subidas.values()][0].recibido).toBe(13 * MB);
  });

  it("espera a que vuelva internet cuando no hay conexión", async () => {
    const { transporte } = servidorFalso({ patch: { 1: "red-antes" } });
    const esperas: string[] = [];
    await subirReanudable(
      base(new Blob([new Uint8Array(7 * MB)]), transporte, {
        hayConexion: () => false,
        esperarConexion: async () => void esperas.push("online"),
        dormir: async () => void esperas.push("dormir"),
        alReintento: (i: { sinConexion: boolean }) => expect(i.sinConexion).toBe(true),
      }),
    );
    expect(esperas).toEqual(["online"]);
  });

  it("se rinde con error 'red' tras varias fallas seguidas y luego se retoma desde donde quedó", async () => {
    // Falla el 2.º PATCH y todos los reintentos siguientes (3 intentos máximo).
    const todas: Record<number, "red-antes"> = { 2: "red-antes", 3: "red-antes", 4: "red-antes" };
    const { transporte, subidas } = servidorFalso({ patch: todas });
    let url = "";
    const archivo = new Blob([new Uint8Array(20 * MB)]);
    const intento1 = subirReanudable(
      base(archivo, transporte, { maxReintentos: 2, alCrear: (u: string) => (url = u) }),
    );
    await expect(intento1).rejects.toMatchObject({ codigo: "red" });
    expect([...subidas.values()][0].recibido).toBe(6 * MB);
    // Segundo intento (otro día de conexión): usa la URL guardada y sigue en 6 MB.
    const { transporte: t2, bitacora } = (() => {
      const f = servidorFalso();
      f.subidas.set(url, subidas.get(url)!);
      return f;
    })();
    await subirReanudable(base(archivo, t2, { urlPrevia: url }));
    expect(subidas.get(url)!.recibido).toBe(20 * MB);
    expect(bitacora.find((b) => b.metodo === "POST")).toBeUndefined();
    expect(bitacora.find((b) => b.metodo === "PATCH")?.offset).toBe(String(6 * MB));
  });

  it("una subida previa que ya no existe se empieza de nuevo", async () => {
    const { transporte, subidas } = servidorFalso();
    await subirReanudable(
      base(new Blob([new Uint8Array(3 * MB)]), transporte, {
        urlPrevia: "http://tus.test/sign/99",
      }),
    );
    expect([...subidas.values()][0].recibido).toBe(3 * MB);
  });

  it("cancelar corta la subida con el código 'cancelada'", async () => {
    const { transporte, subidas } = servidorFalso();
    const control = new AbortController();
    const p = subirReanudable(
      base(new Blob([new Uint8Array(20 * MB)]), transporte, {
        senal: control.signal,
        alProgreso: (n: number) => n >= 6 * MB && control.abort(),
      }),
    );
    await expect(p).rejects.toMatchObject({ codigo: "cancelada" });
    expect([...subidas.values()][0].recibido).toBeLessThan(20 * MB);
  });

  it.each([
    [401, "expirada"],
    [403, "expirada"],
    [413, "demasiado_grande"],
    [404, "no_disponible"],
    [405, "no_disponible"],
    [400, "rechazada"],
  ] as const)("crear con %i → %s (no reintenta)", async (estado, codigo) => {
    const { transporte, bitacora } = servidorFalso({ crear: estado });
    await expect(
      subirReanudable(base(new Blob([new Uint8Array(MB)]), transporte)),
    ).rejects.toMatchObject({ codigo });
    expect(bitacora).toHaveLength(1);
  });

  it("un archivo vacío se rechaza", async () => {
    const { transporte } = servidorFalso();
    await expect(subirReanudable(base(new Blob([]), transporte))).rejects.toBeInstanceOf(
      ErrorDeSubida,
    );
  });

  it("terminarSubida nunca lanza", async () => {
    await expect(
      terminarSubida("http://tus.test/sign/1", {
        apikey: "k",
        firma: "f",
        transporte: async () => {
          throw new TypeError("sin red");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
