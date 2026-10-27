// Página de prueba de los visores, solo para desarrollo (no es una ruta de
// la app ni entra al build). Se abre con `npm run dev` en:
//   http://localhost:8080/src/components/visores/prueba/index.html
//
// Genera archivos de ejemplo en el momento (arcada procedural y un fantoma
// de CBCT, sin datos de pacientes) y permite abrir archivos locales.
import { useState } from "react";
import { createRoot } from "react-dom/client";

import "@/styles.css";

import type { Cargador } from "@/lib/visores/descarga";
import {
  aObj,
  aPlyBinario,
  aStlAscii,
  aStlBinario,
  arcadaDeEjemplo,
  fantomaCbct,
  fantomaCbctZip,
} from "@/lib/visores/ejemplos";

import { VisorConCargador, VisorDeExamen, type TipoExamen } from "../visor-de-examen";

type Abierto =
  | { modo: "url"; tipo: TipoExamen; url: string; nombre: string }
  | { modo: "bytes"; tipo: TipoExamen; nombre: string; cargar: Cargador };

const conBytes =
  (archivos: () => Uint8Array[]): Cargador =>
  async (alProgreso) => {
    const a = archivos();
    alProgreso(
      a.reduce((s, x) => s + x.byteLength, 0),
      null,
    );
    return a;
  };

function urlDe(bytes: Uint8Array, tipo = "application/octet-stream"): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
}

function tipoPorNombre(nombre: string): TipoExamen {
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (ext === "stl" || ext === "ply" || ext === "obj") return ext;
  return "dicom";
}

function Pagina() {
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const [oscuro, setOscuro] = useState(() => document.documentElement.classList.contains("dark"));

  const ejemplos: { label: string; abrir: () => Abierto }[] = [
    {
      label: "Arcada · STL binario (por URL)",
      abrir: () => ({
        modo: "url",
        tipo: "stl",
        nombre: "arcada-ejemplo.stl",
        url: urlDe(aStlBinario(arcadaDeEjemplo())),
      }),
    },
    {
      label: "Arcada · STL ASCII",
      abrir: () => ({
        modo: "url",
        tipo: "stl",
        nombre: "arcada-ascii.stl",
        url: urlDe(aStlAscii(arcadaDeEjemplo())),
      }),
    },
    {
      label: "Arcada · PLY binario",
      abrir: () => ({
        modo: "url",
        tipo: "ply",
        nombre: "arcada.ply",
        url: urlDe(aPlyBinario(arcadaDeEjemplo())),
      }),
    },
    {
      label: "Arcada · OBJ",
      abrir: () => ({
        modo: "url",
        tipo: "obj",
        nombre: "arcada.obj",
        url: urlDe(aObj(arcadaDeEjemplo())),
      }),
    },
    {
      label: "CBCT fantoma · ZIP (por URL)",
      abrir: () => ({
        modo: "url",
        tipo: "dicom",
        nombre: "cbct-fantoma.zip",
        url: urlDe(fantomaCbctZip({ lado: 160, cortes: 120, espaciado: 0.25 }), "application/zip"),
      }),
    },
    {
      label: "CBCT fantoma · 120 archivos sueltos",
      abrir: () => ({
        modo: "bytes",
        tipo: "dicom",
        nombre: "cbct-fantoma (120 archivos)",
        cargar: conBytes(() => fantomaCbct({ lado: 160, cortes: 120, espaciado: 0.25 })),
      }),
    },
    {
      label: "Radiografía (un corte)",
      abrir: () => ({
        modo: "url",
        tipo: "dicom",
        nombre: "radiografia.dcm",
        url: urlDe(fantomaCbct({ lado: 256, cortes: 2, espaciado: 0.1 })[0]),
      }),
    },
    {
      label: "Error: escaneo de 3Shape",
      abrir: () => ({
        modo: "url",
        tipo: "dicom",
        nombre: "escaneo-3shape.dcm",
        url: urlDe(new TextEncoder().encode('<?xml version="1.0"?><HPS version="1.1"></HPS>')),
      }),
    },
  ];

  const abrirLocales = (lista: FileList | null) => {
    if (!lista?.length) return;
    const archivos = [...lista];
    const tipo = archivos.length > 1 ? "dicom" : tipoPorNombre(archivos[0].name);
    setAbierto({
      modo: "bytes",
      tipo,
      nombre: archivos.length > 1 ? `${archivos.length} archivos` : archivos[0].name,
      cargar: async () =>
        Promise.all(archivos.map(async (f) => new Uint8Array(await f.arrayBuffer()))),
    });
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <p className="kicker">Solo desarrollo</p>
        <h1 className="mt-2 font-display text-[40px] font-medium leading-none">
          Visores de <em className="text-brand-600">exámenes</em>
        </h1>
        <p className="mt-3 text-[15px] text-foreground/80">
          Archivos de ejemplo generados en el navegador, sin datos de pacientes.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {ejemplos.map((e) => (
          <button
            key={e.label}
            type="button"
            onClick={() => setAbierto(e.abrir())}
            className="rounded-full border border-control px-3 py-1.5 text-[13px] font-semibold hover:border-foreground"
          >
            {e.label}
          </button>
        ))}
      </div>
      <label className="block space-y-1 text-[14px]">
        <span className="font-medium">
          Abrir archivos locales (STL, PLY, OBJ, DICOM o ZIP; varios = una serie DICOM)
        </span>
        <input
          type="file"
          multiple
          onChange={(e) => abrirLocales(e.target.files)}
          className="block text-[14px]"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          document.documentElement.classList.toggle("dark");
          setOscuro(!oscuro);
        }}
        className="rounded-full border border-control px-3 py-1.5 text-[13px] font-semibold"
      >
        Modo {oscuro ? "claro" : "oscuro"}
      </button>

      {abierto?.modo === "url" && (
        <VisorDeExamen
          tipo={abierto.tipo}
          url={abierto.url}
          nombre={abierto.nombre}
          onCerrar={() => setAbierto(null)}
        />
      )}
      {abierto?.modo === "bytes" && (
        <VisorConCargador
          tipo={abierto.tipo}
          nombre={abierto.nombre}
          cargar={abierto.cargar}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </main>
  );
}

const raiz = document.getElementById("raiz");
if (raiz) createRoot(raiz).render(<Pagina />);
