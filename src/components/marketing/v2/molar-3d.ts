// Molar 3D del hero de /v2 (draft "C sobre /v2", 20-oct-2026).
//
// Este módulo se importa con `import()` y solo desde el cliente: three.js no
// entra en el JS inicial. Lo llama `hero-molar.tsx` cuando la página ya
// cargó, el navegador quedó libre, el escenario está en pantalla y el equipo
// puede (ver lib/marketing/molar-3d-elegible.ts). Hasta entonces, y si algo
// falla, se ve el molar en SVG que llega del servidor.
//
// La pieza es procedural (sin modelos que descargar): una esfera deformada
// en corona con cinco cúspides y fisuras, un tronco y dos raíces torneadas.
// Esmalte con MeshPhysicalMaterial (clearcoat + sheen cálido) y un entorno
// de sala en papel con dos paneles de color: ocre a la derecha y cobalto a
// la izquierda, que dan los bordes de luz.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from "three";

export type Molar3D = {
  /** Con false se queda quieto en el último cuadro (pausa o movimiento reducido). */
  animar(si: boolean): void;
  /** Libera la GPU y saca el canvas. */
  destruir(): void;
};

/** Devuelve el control al navegador entre pasos pesados (sin tareas largas). */
const ceder = () => new Promise<void>((r) => setTimeout(r, 0));

/** GPU por software (SwiftShader, llvmpipe…): ahí el 3D cuesta segundos de CPU. */
function esGpuPorSoftware(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const nombre = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(nombre);
}

const suave = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function coronaGeometria(): SphereGeometry {
  // 120 × 90 segmentos: suficiente para las cúspides y la mitad de vértices
  // que el draft (180 × 130).
  const g = new SphereGeometry(1, 120, 90);
  const pos = g.attributes.position;
  const v = new Vector3();
  const cuspides: readonly [number, number, number][] = [
    [0.46, 0.36, 0.26],
    [-0.46, 0.36, 0.24],
    [0.5, -0.34, 0.22],
    [-0.5, -0.34, 0.2],
    [0, -0.42, 0.16],
  ];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { x, y, z } = v;
    // Sección cuadrada redondeada (superelipse) para la corona.
    const th = Math.atan2(z, x);
    const sq = Math.pow(
      Math.pow(Math.abs(Math.cos(th)), 4) + Math.pow(Math.abs(Math.sin(th)), 4),
      -0.25,
    );
    const k = 1 + (sq - 1) * 0.6;
    let nx = x * k * 1.14;
    let nz = z * k * 0.98;
    let ny: number;
    if (y > 0) {
      ny = y * 0.58;
      const w = suave(0.3, 0.92, y);
      let b = 0;
      for (const [cx, cz, h] of cuspides) {
        const d = (nx - cx) ** 2 + (nz - cz) ** 2;
        b += h * Math.exp(-d / 0.07);
      }
      const fisura = 0.07 * Math.exp(-(nz * nz) / 0.006) + 0.05 * Math.exp(-(nx * nx) / 0.006);
      ny += w * (b - fisura - 0.06);
      const abombado = 1 + 0.06 * Math.sin(Math.min(1, y) * Math.PI);
      nx *= abombado;
      nz *= abombado;
    } else {
      const t = -y;
      ny = y * 0.72;
      const s = 1 - 0.36 * Math.pow(t, 1.6);
      nx *= s;
      nz *= s;
    }
    pos.setXYZ(i, nx, ny, nz);
  }
  g.computeVertexNormals();
  return g;
}

function raizGeometria(lado: -1 | 1): LatheGeometry {
  const perfil: Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    perfil.push(new Vector2(0.42 * Math.pow(1 - t, 0.75) + 0.035, -t * 2.05));
  }
  const g = new LatheGeometry(perfil, 56);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = -p.getY(i) / 2.05;
    p.setX(i, p.getX(i) * 0.95 + lado * (0.14 * t + 0.1 * t * t) - 0.12 * t * t);
    p.setZ(i, p.getZ(i) * 0.72);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Monta el molar en `escenario` (un canvas nuevo, decorativo). Devuelve null
 * si no hay WebGL. Cuando el primer cuadro está listo, agrega `is-3d` al
 * escenario para que el CSS cambie el SVG por el canvas.
 */
export async function montarMolar3D(escenario: HTMLElement): Promise<Molar3D | null> {
  const canvas = document.createElement("canvas");
  canvas.className = "lv-molar-gl";
  canvas.setAttribute("aria-hidden", "true");

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (esGpuPorSoftware(renderer.getContext())) {
    renderer.dispose();
    return null;
  }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const geometrias: BufferGeometry[] = [];
  const materiales: Material[] = [];
  const llevar = <G extends BufferGeometry>(g: G) => (geometrias.push(g), g);

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0.5, 8.9);
  camera.lookAt(0, -0.35, 0);

  // Entorno: sala en papel cálido, dos cajas de luz blancas, panel ocre y
  // panel cobalto. Se hornea una vez en un mapa PMREM y la escena se tira.
  const pmrem = new PMREMGenerator(renderer);
  const sala = new Scene();
  const fondo = new MeshBasicMaterial({ color: 0xe9dfcf, side: BackSide });
  sala.add(new Mesh(new SphereGeometry(10, 24, 12), fondo));
  const panel = (color: number, p: [number, number, number], w: number, h: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color, side: DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    sala.add(m);
  };
  panel(0xffffff, [-4, 5, 4], 6, 4);
  panel(0xffffff, [4, 2.5, 4], 2, 5);
  panel(0xb68235, [5, -1, -4], 8, 8);
  panel(0x2e4bff, [-5, -3, -2], 5, 5);
  await ceder();
  const entorno = pmrem.fromScene(sala, 0.035).texture;
  scene.environment = entorno;
  sala.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
  });
  pmrem.dispose();

  const esmalte = new MeshPhysicalMaterial({
    color: 0xfbf8f3,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    sheen: 0.35,
    sheenColor: new Color(0xffe6c4),
    sheenRoughness: 0.5,
    envMapIntensity: 1.15,
  });
  materiales.push(esmalte);

  await ceder();
  const diente = new Group();
  diente.add(new Mesh(llevar(coronaGeometria()), esmalte));
  const tronco = new Mesh(llevar(new CylinderGeometry(0.74, 0.6, 0.55, 72, 1, false)), esmalte);
  tronco.scale.z = 0.84;
  tronco.position.y = -0.66;
  diente.add(tronco);
  for (const lado of [-1, 1] as const) {
    const r = new Mesh(llevar(raizGeometria(lado)), esmalte);
    r.position.set(lado * 0.4, -0.72, 0);
    diente.add(r);
  }
  diente.position.y = 0.25;
  const soporte = new Group();
  soporte.add(diente);
  scene.add(soporte);

  scene.add(new AmbientLight(0xffe8cc, 0.35));
  const clave = new DirectionalLight(0xffffff, 2.4);
  clave.position.set(-3, 5, 5);
  scene.add(clave);
  const bordeOcre = new DirectionalLight(0xd9963f, 4);
  bordeOcre.position.set(4, -1, -4);
  scene.add(bordeOcre);
  const bordeCobalto = new DirectionalLight(0x3a55ff, 2.2);
  bordeCobalto.position.set(-5, -2, -2);
  scene.add(bordeCobalto);

  await ceder();
  escenario.appendChild(canvas);

  const medir = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  medir();

  // Compila los shaders sin bloquear (KHR_parallel_shader_compile cuando
  // está); si el navegador no lo soporta, compila igual en el primer cuadro.
  if (renderer.extensions.has("KHR_parallel_shader_compile")) {
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      // seguimos: render() compila lo que falte
    }
  }

  // --- Movimiento ---
  let objetivoX = 0;
  let objetivoY = 0;
  let mx = 0;
  let my = 0;
  let giro = 0;
  let vaiven = 0;
  let ultimo = performance.now();
  let raf = 0;
  let animando = false;
  let enPantalla = true;
  let destruido = false;

  const alMover = (e: PointerEvent) => {
    objetivoX = e.clientX / window.innerWidth - 0.5;
    objetivoY = e.clientY / window.innerHeight - 0.5;
  };

  const pintar = (dt: number) => {
    giro += dt * 0.38;
    vaiven += dt;
    mx += (objetivoX - mx) * 0.05;
    my += (objetivoY - my) * 0.05;
    const sy = Math.min(1, window.scrollY / 900);
    soporte.rotation.set(
      0.32 + my * 0.35 + sy * 0.6,
      -0.6 + giro + mx * 0.6,
      -0.12 + Math.sin(vaiven * 0.9) * 0.05,
    );
    soporte.position.y = Math.sin(vaiven * 1.25) * 0.14 - sy * 0.6;
    renderer.render(scene, camera);
  };

  const cuadro = (t: number) => {
    raf = 0;
    const dt = Math.min(0.05, (t - ultimo) / 1000);
    ultimo = t;
    pintar(dt);
    raf = requestAnimationFrame(cuadro);
  };

  const sincronizar = () => {
    const correr = animando && enPantalla && !document.hidden && !destruido;
    if (correr && !raf) {
      ultimo = performance.now();
      raf = requestAnimationFrame(cuadro);
      window.addEventListener("pointermove", alMover, { passive: true });
    } else if (!correr && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("pointermove", alMover);
    }
  };

  const io = new IntersectionObserver(([e]) => {
    enPantalla = e.isIntersecting;
    sincronizar();
  });
  io.observe(escenario);
  const ro = new ResizeObserver(() => {
    medir();
    if (!raf) pintar(0);
  });
  ro.observe(canvas);
  document.addEventListener("visibilitychange", sincronizar);

  // Primer cuadro: el molar ya en pose, y recién ahí se cambia el SVG.
  pintar(0);
  escenario.classList.add("is-3d");

  return {
    animar(si) {
      animando = si;
      sincronizar();
    },
    destruir() {
      destruido = true;
      sincronizar();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", sincronizar);
      window.removeEventListener("pointermove", alMover);
      escenario.classList.remove("is-3d");
      for (const g of geometrias) g.dispose();
      for (const m of materiales) m.dispose();
      entorno.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
