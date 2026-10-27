// Escena three.js del visor 3D (IMG-03). Solo se importa desde visor-3d.tsx,
// que a su vez entra con React.lazy: three.js nunca llega al JS inicial.
//
// Controles: OrbitControls (un dedo o clic izquierdo gira, pinza o rueda
// acerca, dos dedos o clic derecho desplazan). Medir: dos toques sobre la
// malla; la distancia sale en las unidades del archivo, que en escaneos
// dentales son milímetros.
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Malla } from "@/lib/visores/malla";
import { distancia3d, type Punto3 } from "@/lib/visores/medida";

export type Vista = "inicial" | "superior" | "inferior" | "frontal";

export type Escena3D = {
  vista(v: Vista): void;
  color(hex: string | null): void;
  opacidad(o: number): void;
  modoMedir(si: boolean): void;
  limpiarMedida(): void;
  /** Gira la cámara en radianes (teclado). */
  rotar(azimut: number, polar: number): void;
  /** >1 acerca, <1 aleja (teclado y botones). */
  acercar(factor: number): void;
  destruir(): void;
};

export type OpcionesEscena = {
  /** Color de la medida: el cobalto de datos, leído de los tokens. */
  colorMedida: string;
  alMedir(puntos: Punto3[], mm: number | null): void;
};

/** Sobre esto se omite suavizar normales (mergeVertices tarda segundos). */
const MAX_TRIANGULOS_SUAVIZAR = 1_500_000;

export function crearEscena(
  contenedor: HTMLElement,
  malla: Malla,
  opciones: OpcionesEscena,
): Escena3D {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  canvas.setAttribute("aria-hidden", "true");
  contenedor.appendChild(canvas);

  const escena = new Scene();
  const camara = new PerspectiveCamera(35, 1, 0.1, 10_000);

  // Geometría.
  let geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(malla.posiciones, 3));
  if (malla.indices) geo.setIndex(new BufferAttribute(malla.indices, 1));
  if (malla.colores) geo.setAttribute("color", new BufferAttribute(malla.colores, 3));
  if (!malla.indices && malla.triangulos <= MAX_TRIANGULOS_SUAVIZAR) {
    // El STL repite cada vértice por triángulo: se unen para que la luz
    // sea suave y no se vean facetas.
    geo = mergeVertices(geo, 1e-4);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const caja = geo.boundingBox ?? new Box3();
  const centro = caja.getCenter(new Vector3());
  const radio = Math.max(geo.boundingSphere?.radius ?? 1, 1e-3);
  geo.translate(-centro.x, -centro.y, -centro.z);

  const material = new MeshStandardMaterial({
    color: 0xe9e4d8,
    roughness: 0.62,
    metalness: 0,
    side: DoubleSide,
    vertexColors: false,
  });
  const modelo = new Mesh(geo, material);
  escena.add(modelo);

  escena.add(new HemisphereLight(0xffffff, 0x8a8172, 1.1));
  escena.add(new AmbientLight(0xffffff, 0.25));
  const luz = new DirectionalLight(0xffffff, 1.4);
  camara.add(luz);
  luz.position.set(0.4, 0.8, 1);
  escena.add(camara);

  // Z arriba (oclusal): OrbitControls fija el "arriba" al crearse.
  camara.up.set(0, 0, 1);
  const controles = new OrbitControls(camara, canvas);
  controles.enableDamping = false;
  controles.zoomToCursor = true;
  controles.minDistance = radio * 0.15;
  controles.maxDistance = radio * 12;

  // Medida.
  const grupoMedida = new Group();
  grupoMedida.renderOrder = 10;
  escena.add(grupoMedida);
  const matMedida = new MeshBasicMaterial({
    color: new Color(opciones.colorMedida),
    depthTest: false,
  });
  const matLinea = new LineBasicMaterial({
    color: new Color(opciones.colorMedida),
    depthTest: false,
  });
  const esfera = new SphereGeometry(radio * 0.012, 16, 12);
  let puntos: Vector3[] = [];
  let midiendo = false;

  const pintarMedida = () => {
    grupoMedida.clear();
    for (const p of puntos) {
      const m = new Mesh(esfera, matMedida);
      m.position.copy(p);
      m.renderOrder = 10;
      grupoMedida.add(m);
    }
    if (puntos.length === 2) {
      const l = new Line(new BufferGeometry().setFromPoints(puntos), matLinea);
      l.renderOrder = 10;
      grupoMedida.add(l);
    }
    // Las coordenadas se informan en el sistema del archivo (sin centrar).
    const enArchivo = puntos.map((p) => [p.x + centro.x, p.y + centro.y, p.z + centro.z] as Punto3);
    opciones.alMedir(
      enArchivo,
      enArchivo.length === 2 ? distancia3d(enArchivo[0], enArchivo[1]) : null,
    );
    pedirCuadro();
  };

  const raycaster = new Raycaster();
  let inicio: { x: number; y: number } | null = null;
  const alBajar = (e: PointerEvent) => {
    inicio = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  };
  const alSubir = (e: PointerEvent) => {
    if (!midiendo || !inicio || !e.isPrimary) return;
    const movio = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5;
    inicio = null;
    if (movio) return; // fue un giro, no un toque
    const r = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camara);
    const [hit] = raycaster.intersectObject(modelo, false);
    if (!hit) return;
    puntos = puntos.length >= 2 ? [hit.point.clone()] : [...puntos, hit.point.clone()];
    pintarMedida();
  };
  canvas.addEventListener("pointerdown", alBajar);
  canvas.addEventListener("pointerup", alSubir);

  // Render bajo demanda: sin bucle cuando nada se mueve.
  let pendiente = 0;
  const render = () => {
    pendiente = 0;
    renderer.render(escena, camara);
  };
  function pedirCuadro() {
    if (!pendiente) pendiente = requestAnimationFrame(render);
  }
  controles.addEventListener("change", pedirCuadro);

  const redimensionar = () => {
    const w = Math.max(1, contenedor.clientWidth);
    const h = Math.max(1, contenedor.clientHeight);
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
    pedirCuadro();
  };
  const observador = new ResizeObserver(redimensionar);
  observador.observe(contenedor);

  // Distancia para que el modelo entre entero: con pantalla vertical (teléfono)
  // manda el campo horizontal, que es el más angosto.
  const distanciaInicial = () => {
    const vertical = (camara.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camara.aspect);
    return (radio / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  };
  const vista = (v: Vista) => {
    // Z es la dirección oclusal en la mayoría de los escáneres; Y, la
    // anteroposterior. "Frontal" mira desde −Y (vestibular de los anteriores).
    const d = distanciaInicial();
    const posiciones: Record<Vista, [number, number, number]> = {
      inicial: [0, -d * 0.7, d * 0.7],
      // Un pelo corrido en Y: justo en el polo la órbita queda indefinida.
      superior: [0, -d * 0.002, d],
      inferior: [0, -d * 0.002, -d],
      frontal: [0, -d, 0],
    };
    const [x, y, z] = posiciones[v];
    camara.position.set(x, y, z);
    controles.target.set(0, 0, 0);
    camara.lookAt(0, 0, 0);
    controles.update();
    pedirCuadro();
  };

  redimensionar();
  vista("inicial");

  const esfericas = new Vector3();
  return {
    vista,
    color(hex) {
      if (hex === null && malla.colores) {
        material.vertexColors = true;
        material.color.set(0xffffff);
      } else {
        material.vertexColors = false;
        material.color.set(hex ?? 0xe9e4d8);
      }
      material.needsUpdate = true;
      pedirCuadro();
    },
    opacidad(o) {
      material.opacity = o;
      material.transparent = o < 1;
      material.depthWrite = o >= 1;
      material.needsUpdate = true;
      pedirCuadro();
    },
    modoMedir(si) {
      midiendo = si;
      canvas.style.cursor = si ? "crosshair" : "";
    },
    limpiarMedida() {
      puntos = [];
      pintarMedida();
    },
    rotar(azimut, polar) {
      esfericas.copy(camara.position).sub(controles.target);
      const largo = esfericas.length();
      const theta = Math.atan2(esfericas.x, esfericas.y) + azimut;
      const phi = Math.min(Math.PI - 0.01, Math.max(0.01, Math.acos(esfericas.z / largo) + polar));
      camara.position.set(
        controles.target.x + largo * Math.sin(phi) * Math.sin(theta),
        controles.target.y + largo * Math.sin(phi) * Math.cos(theta),
        controles.target.z + largo * Math.cos(phi),
      );
      camara.lookAt(controles.target);
      controles.update();
      pedirCuadro();
    },
    acercar(factor) {
      const dir = camara.position.clone().sub(controles.target);
      const nuevo = Math.min(
        controles.maxDistance,
        Math.max(controles.minDistance, dir.length() / factor),
      );
      camara.position.copy(controles.target).add(dir.setLength(nuevo));
      controles.update();
      pedirCuadro();
    },
    destruir() {
      cancelAnimationFrame(pendiente);
      observador.disconnect();
      canvas.removeEventListener("pointerdown", alBajar);
      canvas.removeEventListener("pointerup", alSubir);
      controles.dispose();
      geo.dispose();
      esfera.dispose();
      material.dispose();
      matMedida.dispose();
      matLinea.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
