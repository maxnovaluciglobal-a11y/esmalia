// Visor DICOM/CBCT (IMG-04): cortes axial, coronal y sagital con ventana y
// nivel, desplazamiento por cortes, zoom y medición en mm. Entra con
// React.lazy desde visor-de-examen.tsx (chunk aparte, sin librerías).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { QUERY_TACTIL, useMediaQuery } from "@/hooks/use-media-query";
import type { Cargador } from "@/lib/visores/descarga";
import { formatoFechaDicom, nombreDeModalidad } from "@/lib/visores/dicom";
import { distanciaEnCorte, formatoMm, type Punto2 } from "@/lib/visores/medida";
import {
  MAX_VOXELES,
  MAX_VOXELES_EQUIPO_CHICO,
  VENTANAS_CT,
  abrirArchivosDicom,
  aplicarVentana,
  cantidadDeCortes,
  construirVolumen,
  extraerCorte,
  type Plano,
  type Volumen,
} from "@/lib/visores/volumen";
import { cn } from "@/lib/utils";

import {
  Chip,
  DISPOSICION,
  Deslizador,
  ESCENARIO,
  EstadoCargando,
  EstadoError,
  FOCO,
  GrupoChips,
  LATERAL,
  PanelDatos,
  useCargaDeExamen,
} from "./controles";
import { numero } from "@/lib/formato-fecha";

type Herramienta = "mover" | "ventana" | "medir";
type Ventana = { centro: number; ancho: number };
type Medida = { plano: Plano; indice: number; a: Punto2; b: Punto2 | null };

const PLANOS: { id: Plano; label: string }[] = [
  { id: "axial", label: "Axial" },
  { id: "coronal", label: "Coronal" },
  { id: "sagital", label: "Sagital" },
];

const HERRAMIENTAS: { id: Herramienta; label: string; ayuda: string }[] = [
  { id: "mover", label: "Mover", ayuda: "Arrastra para desplazar la imagen" },
  {
    id: "ventana",
    label: "Brillo y contraste",
    ayuda: "Arrastra: horizontal cambia el contraste, vertical el brillo",
  },
  { id: "medir", label: "Medir", ayuda: "Toca dos puntos del corte" },
];

function presupuestoDeVoxeles(): number {
  if (typeof navigator === "undefined") return MAX_VOXELES;
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const tactil = typeof window !== "undefined" && window.matchMedia?.(QUERY_TACTIL).matches;
  return (memoria !== undefined && memoria <= 4) || tactil ? MAX_VOXELES_EQUIPO_CHICO : MAX_VOXELES;
}

function leerToken(nombre: string, respaldo: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return v || respaldo;
}

export default function VisorDicom({
  cargar,
  intento,
  onReintentar,
}: {
  cargar: Cargador;
  intento: number;
  onReintentar: () => void;
}) {
  const preparar = useCallback(
    (archivos: Uint8Array[]) =>
      construirVolumen(abrirArchivosDicom(archivos), { maxVoxeles: presupuestoDeVoxeles() }),
    [],
  );
  const estado = useCargaDeExamen(cargar, preparar, intento);
  if (estado.fase === "cargando") return <EstadoCargando {...estado} que="el estudio" />;
  if (estado.fase === "error")
    return <EstadoError mensaje={estado.mensaje} onReintentar={onReintentar} />;
  return <VisorDicomListo vol={estado.datos} />;
}

function VisorDicomListo({ vol }: { vol: Volumen }) {
  const uid = useId();
  const esVolumen = vol.profundidad > 1;
  const pantallaAncha = useMediaQuery("(min-width: 1024px)");
  const [plano, setPlano] = useState<Plano>("axial");
  const [tres, setTres] = useState(false);
  const [indices, setIndices] = useState<Record<Plano, number>>(() => ({
    axial: Math.floor(vol.profundidad / 2),
    coronal: Math.floor(vol.alto / 2),
    sagital: Math.floor(vol.ancho / 2),
  }));
  const [ventana, setVentana] = useState<Ventana>(vol.ventanaInicial);
  const [herramienta, setHerramienta] = useState<Herramienta>("mover");
  const [medida, setMedida] = useState<Medida | null>(null);
  const [reinicio, setReinicio] = useState(0);

  const verTres = tres && esVolumen && pantallaAncha;
  const planosVisibles: Plano[] = verTres
    ? ["axial", "coronal", "sagital"]
    : [esVolumen ? plano : "axial"];
  const esCt = vol.modalidad === "CT";
  const rango = Math.max(1, vol.maximo - vol.minimo);

  const mmMedida = useMemo(() => {
    if (!medida?.b) return null;
    const esp = extraerCorte(vol, medida.plano, medida.indice).espaciado;
    return distanciaEnCorte(medida.a, medida.b, esp);
  }, [medida, vol]);

  const cambiarIndice = (p: Plano, n: number) =>
    setIndices((prev) => ({
      ...prev,
      [p]: Math.max(0, Math.min(cantidadDeCortes(vol, p) - 1, n)),
    }));

  const fecha = formatoFechaDicom(vol.fechaEstudio);
  const fmt = (n: number, d = 2) => numero(n, { maximumFractionDigits: d });
  const [ex, ey, ez] = vol.espaciado;
  const avisos = [
    vol.reduccion > 1 &&
      `Se muestra a 1/${vol.reduccion} de la resolución por eje para no saturar la memoria de este equipo; las medidas siguen siendo en mm reales.`,
    vol.espaciadoAproximado &&
      "El archivo no trae el espaciado del paciente: las medidas son aproximadas (espaciado del detector o 1 mm por píxel).",
    vol.espesorSupuesto &&
      "El archivo no indica la distancia entre cortes: se supuso igual al tamaño del píxel.",
    vol.seriesIgnoradas > 0 &&
      `El archivo trae ${vol.seriesIgnoradas + 1} series; se muestra la que tiene más imágenes.`,
  ].filter((a): a is string => Boolean(a));

  const textoMedida =
    mmMedida !== null && medida
      ? `${formatoMm(mmMedida)} · corte ${medida.plano} ${medida.indice + 1}`
      : medida
        ? "Toca el segundo punto"
        : herramienta === "medir"
          ? "Toca dos puntos del corte"
          : "Sin medida";

  return (
    <div className={DISPOSICION}>
      <div className={cn(ESCENARIO, "bg-night")}>
        <div
          className={cn(
            "grid h-full gap-px bg-night-line",
            verTres ? "grid-cols-3" : "grid-cols-1",
          )}
        >
          {planosVisibles.map((p) => (
            <VistaCorte
              key={p}
              vol={vol}
              plano={p}
              indice={indices[p]}
              onIndice={(n) => cambiarIndice(p, n)}
              ventana={ventana}
              onVentana={setVentana}
              herramienta={herramienta}
              onHerramienta={setHerramienta}
              medida={medida?.plano === p && medida.indice === indices[p] ? medida : null}
              onMedida={setMedida}
              reinicio={reinicio}
              descripcionId={`${uid}-datos`}
              conEtiqueta={esVolumen}
            />
          ))}
        </div>
      </div>

      <aside className={LATERAL}>
        {esVolumen && (
          <GrupoChips etiqueta="Corte">
            {PLANOS.map((p) => (
              <Chip
                key={p.id}
                activo={!verTres && plano === p.id}
                onClick={() => (setPlano(p.id), setTres(false))}
              >
                {p.label}
              </Chip>
            ))}
            {pantallaAncha && (
              <Chip activo={verTres} onClick={() => setTres((v) => !v)}>
                Los tres
              </Chip>
            )}
          </GrupoChips>
        )}

        <GrupoChips etiqueta="Herramienta">
          {HERRAMIENTAS.map((h) => (
            <Chip
              key={h.id}
              activo={herramienta === h.id}
              onClick={() => setHerramienta(h.id)}
              titulo={h.ayuda}
            >
              {h.label}
            </Chip>
          ))}
          <Chip onClick={() => setMedida(null)} disabled={!medida}>
            Borrar medida
          </Chip>
          <Chip onClick={() => setReinicio((n) => n + 1)} titulo="Tecla 0">
            Restablecer zoom
          </Chip>
        </GrupoChips>

        <GrupoChips etiqueta="Ventana">
          <Chip
            activo={
              ventana.centro === vol.ventanaInicial.centro &&
              ventana.ancho === vol.ventanaInicial.ancho
            }
            onClick={() => setVentana(vol.ventanaInicial)}
          >
            Inicial
          </Chip>
          {esCt &&
            VENTANAS_CT.map((v) => (
              <Chip
                key={v.id}
                activo={ventana.centro === v.centro && ventana.ancho === v.ancho}
                onClick={() => setVentana({ centro: v.centro, ancho: v.ancho })}
              >
                {v.label}
              </Chip>
            ))}
        </GrupoChips>

        <Deslizador
          etiqueta="Nivel (brillo)"
          valor={ventana.centro}
          min={vol.minimo}
          max={vol.maximo}
          onCambiar={(centro) => setVentana((v) => ({ ...v, centro }))}
          textoValor={fmt(ventana.centro, 0)}
        />
        <Deslizador
          etiqueta="Ancho (contraste)"
          valor={Math.min(ventana.ancho, rango * 2)}
          min={1}
          max={Math.max(2, Math.round(rango * 2))}
          onCambiar={(ancho) => setVentana((v) => ({ ...v, ancho }))}
          textoValor={fmt(ventana.ancho, 0)}
        />

        <PanelDatos
          id={`${uid}-datos`}
          titulo="Datos del estudio"
          filas={[
            { termino: "Modalidad", valor: nombreDeModalidad(vol.modalidad) },
            { termino: "Fecha", valor: fecha ?? "Sin dato" },
            {
              termino: esVolumen ? "Cortes" : "Imagen",
              valor: (
                <span className="cifra">
                  {vol.ancho} × {vol.alto}
                  {esVolumen ? ` × ${vol.profundidad}` : " px"}
                </span>
              ),
            },
            {
              termino: "Vóxel",
              valor: (
                <span className="cifra text-cobalt-on-night">
                  {fmt(ex, 3)} × {fmt(ey, 3)}
                  {esVolumen ? ` × ${fmt(ez, 3)}` : ""} mm
                </span>
              ),
            },
            {
              termino: "Campo",
              valor: (
                <span className="cifra text-cobalt-on-night">
                  {fmt(vol.ancho * ex, 1)} × {fmt(vol.alto * ey, 1)}
                  {esVolumen ? ` × ${fmt(vol.profundidad * ez, 1)}` : ""} mm
                </span>
              ),
            },
            ...(esVolumen
              ? planosVisibles.map((p) => ({
                  termino: `Corte ${p}`,
                  valor: (
                    <span className="cifra">
                      {indices[p] + 1} de {cantidadDeCortes(vol, p)}
                    </span>
                  ),
                }))
              : []),
            {
              termino: "Ventana",
              valor: (
                <span className="cifra">
                  N {fmt(ventana.centro, 0)} · A {fmt(ventana.ancho, 0)}
                </span>
              ),
            },
            {
              termino: "Medida",
              valor: (
                <span
                  aria-live="polite"
                  className={cn(
                    mmMedida !== null
                      ? "cifra text-[18px] text-cobalt-on-night"
                      : "text-on-night-2",
                  )}
                >
                  {textoMedida}
                </span>
              ),
            },
          ]}
        >
          {avisos.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-on-night">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12.5px] leading-relaxed text-on-night-2">
            Del encabezado solo se leen la fecha, la modalidad y las medidas de la imagen: el visor
            no lee ni muestra el nombre, el RUT ni otros datos personales. Rueda o flechas ↑↓ para
            cambiar de corte; pinza o Ctrl + rueda para acercar.
          </p>
        </PanelDatos>
      </aside>
    </div>
  );
}

// ─── Una vista ───────────────────────────────────────────────────────────

type Transformacion = { zoom: number; x: number; y: number };
const SIN_TRANSFORMACION: Transformacion = { zoom: 1, x: 0, y: 0 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 16;
const CENTRO = { x: 0, y: 0 };

/**
 * Zoom hacia un punto: lo que estaba bajo `antes` queda bajo `despues`
 * (coordenadas relativas al centro de la vista). Así la pinza y Ctrl + rueda
 * acercan donde están los dedos o el cursor, no al centro.
 */
function zoomHacia(
  t0: Transformacion,
  zoom: number,
  antes: { x: number; y: number },
  despues: { x: number; y: number },
): Transformacion {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const k = z / t0.zoom;
  return { zoom: z, x: despues.x - k * (antes.x - t0.x), y: despues.y - k * (antes.y - t0.y) };
}

function VistaCorte({
  vol,
  plano,
  indice,
  onIndice,
  ventana,
  onVentana,
  herramienta,
  onHerramienta,
  medida,
  onMedida,
  reinicio,
  descripcionId,
  conEtiqueta,
}: {
  vol: Volumen;
  plano: Plano;
  indice: number;
  onIndice: (n: number) => void;
  ventana: Ventana;
  onVentana: (v: Ventana) => void;
  herramienta: Herramienta;
  onHerramienta: (h: Herramienta) => void;
  medida: Medida | null;
  onMedida: (m: Medida | null) => void;
  reinicio: number;
  descripcionId: string;
  conEtiqueta: boolean;
}) {
  const uid = useId();
  const marcoRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fueraRef = useRef<HTMLCanvasElement | null>(null);
  const geometria = useRef({ ox: 0, oy: 0, escalaX: 1, escalaY: 1 });
  const [t, setT] = useState<Transformacion>(SIN_TRANSFORMACION);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const total = cantidadDeCortes(vol, plano);
  const corte = useMemo(() => extraerCorte(vol, plano, indice), [vol, plano, indice]);

  useEffect(() => setT(SIN_TRANSFORMACION), [reinicio]);

  useEffect(() => {
    const el = marcoRef.current;
    if (!el) return;
    const medir = () => setTam({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pinta el corte con la ventana en un canvas del tamaño real de la imagen…
  useEffect(() => {
    const fuera = (fueraRef.current ??= document.createElement("canvas"));
    fuera.width = corte.ancho;
    fuera.height = corte.alto;
    const ctx = fuera.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(corte.ancho, corte.alto);
    aplicarVentana(corte, ventana.centro, ventana.ancho, vol.invertido, img.data);
    ctx.putImageData(img, 0, 0);
  }, [corte, ventana, vol.invertido]);

  // …y lo lleva a pantalla respetando el tamaño físico del píxel.
  useEffect(() => {
    const canvas = canvasRef.current;
    const fuera = fueraRef.current;
    if (!canvas || !fuera || !tam.w || !tam.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(tam.w * dpr);
    canvas.height = Math.round(tam.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tam.w, tam.h);
    const [sx, sy] = corte.espaciado;
    const mmW = corte.ancho * sx;
    const mmH = corte.alto * sy;
    const base = Math.min(tam.w / mmW, tam.h / mmH) * 0.96;
    const s = base * t.zoom;
    const dw = mmW * s;
    const dh = mmH * s;
    const ox = (tam.w - dw) / 2 + t.x;
    const oy = (tam.h - dh) / 2 + t.y;
    geometria.current = { ox, oy, escalaX: sx * s, escalaY: sy * s };
    ctx.imageSmoothingEnabled = t.zoom < 3;
    ctx.drawImage(fuera, ox, oy, dw, dh);

    if (medida) {
      const color = leerToken("--cobalt-on-night", "#8e9dff");
      const aPantalla = (p: Punto2) => [ox + p[0] * sx * s, oy + p[1] * sy * s] as const;
      const a = aPantalla(medida.a);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      const marca = (p: readonly [number, number]) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
        ctx.fill();
      };
      marca(a);
      if (medida.b) {
        const b = aPantalla(medida.b);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        marca(b);
        const mm = distanciaEnCorte(medida.a, medida.b, corte.espaciado);
        const texto = formatoMm(mm);
        ctx.font = `600 13px ${leerToken("--font-data", "ui-monospace, monospace")}`;
        const w = ctx.measureText(texto).width;
        const mx = (a[0] + b[0]) / 2 + 8;
        const my = (a[1] + b[1]) / 2 - 8;
        ctx.fillStyle = leerToken("--night", "#15120f");
        ctx.fillRect(mx - 4, my - 14, w + 8, 20);
        ctx.fillStyle = color;
        ctx.fillText(texto, mx, my);
      }
    }
  }, [corte, ventana, tam, t, medida, vol.invertido]);

  const aPixel = (clientX: number, clientY: number): Punto2 | null => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return null;
    const g = geometria.current;
    const x = (clientX - r.left - g.ox) / g.escalaX;
    const y = (clientY - r.top - g.oy) / g.escalaY;
    if (x < 0 || y < 0 || x > corte.ancho || y > corte.alto) return null;
    return [x, y];
  };

  // Gestos: un puntero según la herramienta; dos punteros = pinza + desplazar.
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{
    inicio: { x: number; y: number };
    ultimo: { x: number; y: number };
    movio: boolean;
    pinza?: { dist: number; medio: { x: number; y: number }; t: Transformacion };
    ventana: Ventana;
  } | null>(null);

  /** Punto de pantalla relativo al centro de la vista. */
  const relativo = (x: number, y: number) => {
    const r = marcoRef.current?.getBoundingClientRect();
    return r ? { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 } : { x: 0, y: 0 };
  };
  const medio = () => {
    const ps = [...punteros.current.values()];
    return {
      dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
      medio: relativo((ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2),
    };
  };

  const alBajar = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Puntero sintético o ya liberado: el gesto sigue sin captura.
    }
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 1) {
      gesto.current = {
        inicio: { x: e.clientX, y: e.clientY },
        ultimo: { x: e.clientX, y: e.clientY },
        movio: false,
        ventana,
      };
    } else if (punteros.current.size === 2 && gesto.current) {
      const m = medio();
      gesto.current.pinza = { dist: m.dist, medio: m.medio, t };
      gesto.current.movio = true;
    }
  };

  const alMover = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId) || !gesto.current) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesto.current;
    if (g.pinza && punteros.current.size >= 2) {
      const m = medio();
      const zoom = g.pinza.t.zoom * (m.dist / Math.max(1, g.pinza.dist));
      setT(zoomHacia(g.pinza.t, zoom, g.pinza.medio, m.medio));
      return;
    }
    const dx = e.clientX - g.ultimo.x;
    const dy = e.clientY - g.ultimo.y;
    g.ultimo = { x: e.clientX, y: e.clientY };
    if (Math.hypot(e.clientX - g.inicio.x, e.clientY - g.inicio.y) > 5) g.movio = true;
    if (!g.movio) return;
    if (herramienta === "mover" || e.buttons === 4) {
      setT((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    } else if (herramienta === "ventana") {
      const k = Math.max(1, (vol.maximo - vol.minimo) / 400);
      const total = { x: e.clientX - g.inicio.x, y: e.clientY - g.inicio.y };
      onVentana({
        ancho: Math.max(1, Math.round(g.ventana.ancho + total.x * k)),
        centro: Math.round(g.ventana.centro - total.y * k),
      });
    }
  };

  const alSubir = (e: React.PointerEvent) => {
    const g = gesto.current;
    punteros.current.delete(e.pointerId);
    if (punteros.current.size > 0) return;
    gesto.current = null;
    if (!g || g.movio || herramienta !== "medir") return;
    const p = aPixel(e.clientX, e.clientY);
    if (!p) return;
    if (!medida || medida.b) onMedida({ plano, indice, a: p, b: null });
    else onMedida({ ...medida, b: p });
  };

  useEffect(() => {
    const el = marcoRef.current;
    if (!el) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const cursor = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
        setT((prev) => zoomHacia(prev, prev.zoom * Math.exp(-e.deltaY * 0.01), cursor, cursor));
      } else if (Math.abs(e.deltaY) > 0.5) {
        onIndiceRef.current(indiceRef.current + Math.sign(e.deltaY));
      }
    };
    el.addEventListener("wheel", alRodar, { passive: false });
    return () => el.removeEventListener("wheel", alRodar);
  }, []);
  const onIndiceRef = useRef(onIndice);
  onIndiceRef.current = onIndice;
  const indiceRef = useRef(indice);
  indiceRef.current = indice;

  const alTeclear = (e: React.KeyboardEvent) => {
    const paso = e.shiftKey ? 10 : 1;
    const acciones: Record<string, () => void> = {
      ArrowUp: () => onIndice(indice + paso),
      ArrowRight: () => onIndice(indice + paso),
      PageUp: () => onIndice(indice + 10),
      ArrowDown: () => onIndice(indice - paso),
      ArrowLeft: () => onIndice(indice - paso),
      PageDown: () => onIndice(indice - 10),
      Home: () => onIndice(0),
      End: () => onIndice(total - 1),
      "+": () => setT((p) => zoomHacia(p, p.zoom * 1.25, CENTRO, CENTRO)),
      "=": () => setT((p) => zoomHacia(p, p.zoom * 1.25, CENTRO, CENTRO)),
      "-": () => setT((p) => zoomHacia(p, p.zoom / 1.25, CENTRO, CENTRO)),
      "0": () => setT(SIN_TRANSFORMACION),
      m: () => onHerramienta(herramienta === "medir" ? "mover" : "medir"),
      M: () => onHerramienta(herramienta === "medir" ? "mover" : "medir"),
    };
    const accion = acciones[e.key];
    if (accion) {
      e.preventDefault();
      accion();
    }
  };

  const nombre = PLANOS.find((p) => p.id === plano)?.label ?? plano;

  return (
    <div className="flex min-h-0 min-w-0 flex-col bg-night">
      <div
        ref={marcoRef}
        tabIndex={0}
        role="application"
        aria-roledescription="visor de cortes"
        aria-label={`Corte ${nombre.toLowerCase()} ${indice + 1} de ${total}. Flechas para cambiar de corte, más y menos para acercar, 0 para restablecer, M para medir.`}
        aria-describedby={descripcionId}
        onKeyDown={alTeclear}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSubir}
        onPointerCancel={alSubir}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "relative min-h-0 flex-1 touch-none select-none overflow-hidden",
          herramienta === "medir"
            ? "cursor-crosshair"
            : herramienta === "ventana"
              ? "cursor-ns-resize"
              : "cursor-grab",
          FOCO,
          "focus-visible:outline-offset-[-3px]",
        )}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
        {conEtiqueta && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-night/80 px-2 py-0.5 text-[12px] font-semibold text-on-night">
            {nombre}{" "}
            <span className="cifra text-on-night-2">
              {indice + 1}/{total}
            </span>
          </span>
        )}
      </div>
      {total > 1 && (
        <label className="flex items-center gap-2 border-t border-night-line px-3 py-1.5 text-[12px] text-on-night-2">
          <span className="sr-only">Corte {nombre.toLowerCase()}</span>
          <input
            id={`${uid}-corte`}
            type="range"
            min={0}
            max={total - 1}
            value={indice}
            aria-valuetext={`Corte ${indice + 1} de ${total}`}
            onChange={(e) => onIndice(Number(e.target.value))}
            className={cn("h-6 w-full cursor-pointer accent-on-night pointer-coarse:h-9", FOCO)}
          />
        </label>
      )}
    </div>
  );
}
