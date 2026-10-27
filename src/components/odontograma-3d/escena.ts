// Escena three.js del odontograma 3D (ODO-10). Solo la importa
// odontograma-3d.tsx, que entra con React.lazy: three.js nunca llega al JS
// inicial de la ficha.
//
// Piezas estilizadas (no anatómicas): una corona de caja redondeada con una
// cara por superficie del odontograma, más una raíz cónica. Cada cara se pinta
// con el color de la marca que gana en el 2D. Solo lectura: tocar una pieza
// avisa cuál es; las marcas se siguen haciendo en el diagrama 2D.
//
// Controles: OrbitControls (un dedo o clic gira, pinza o rueda acerca, dos
// dedos o clic derecho desplazan) y los botones del componente.
import {
  AmbientLight,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { OdontogramMark } from "@/lib/clinical/odontogram";
import {
  carasDeLaCorona,
  colocarPieza,
  pinturaDePieza,
  type Pintura,
} from "@/lib/clinical/odontograma-3d";

export type VistaOdonto = "frontal" | "superior" | "inferior" | "inicial";

export type EscenaOdonto = {
  actualizar(
    piezas: readonly number[],
    porPieza: ReadonlyMap<number, readonly OdontogramMark[]>,
  ): void;
  seleccionar(tooth: number | null): void;
  vista(v: VistaOdonto): void;
  rotar(azimut: number, polar: number): void;
  acercar(factor: number): void;
  destruir(): void;
};

export type OpcionesEscenaOdonto = {
  /** Color de la pieza elegida (token de marca, leído del CSS). */
  colorSeleccion: string;
  alElegir(tooth: number): void;
  alSobrevolar(tooth: number | null): void;
};

// Colores del render, no de la interfaz: marfil del diente y raíz, como el
// diente anatómico del 2D (que también usa marfil fijo en claro y oscuro).
const MARFIL = 0xf3ead7;
const RAIZ = 0xe2d3b4;

export function crearEscenaOdonto(
  contenedor: HTMLElement,
  opciones: OpcionesEscenaOdonto,
): EscenaOdonto {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  // El lienzo no se lee: la alternativa es la descripción textual del componente.
  canvas.setAttribute("aria-hidden", "true");
  contenedor.appendChild(canvas);

  const escena = new Scene();
  const camara = new PerspectiveCamera(32, 1, 0.1, 200);
  escena.add(new HemisphereLight(0xffffff, 0x8a8172, 1.15));
  escena.add(new AmbientLight(0xffffff, 0.3));
  const luz = new DirectionalLight(0xffffff, 1.3);
  luz.position.set(0.3, 0.6, 1);
  camara.add(luz);
  escena.add(camara);

  const controles = new OrbitControls(camara, canvas);
  controles.enableDamping = false;
  controles.minDistance = 4;
  controles.maxDistance = 30;
  // Centro de la arcada: los incisivos quedan en z ≈ 3,8 y los terceros molares en z ≈ −1,2.
  const CENTRO_Z = 1.2;
  controles.target.set(0, 0, CENTRO_Z);

  const arcada = new Group();
  escena.add(arcada);
  const piezasEnEscena = new Map<number, Group>();
  // Geometrías compartidas por tipo y tamaño: se crean una vez.
  const geometrias = new Map<string, RoundedBoxGeometry | ConeGeometry | TorusGeometry>();
  const materiales: Material[] = [];
  let seleccionada: number | null = null;

  const material = (p: Pintura | null, base: number, fantasma: boolean) => {
    // "Por realizar" va más claro, como en el 2D (opacidad sobre el marfil):
    // se mezcla el color con el marfil en vez de volver la cara transparente.
    const color = new Color(base);
    if (p) color.set(p.color).lerp(new Color(base), 1 - p.opacidad);
    const m = new MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0,
      transparent: fantasma,
      opacity: fantasma ? 0.18 : 1,
      depthWrite: !fantasma,
    });
    materiales.push(m);
    return m;
  };

  const geo = <T extends RoundedBoxGeometry | ConeGeometry | TorusGeometry>(
    clave: string,
    crear: () => T,
  ): T => {
    let g = geometrias.get(clave) as T | undefined;
    if (!g) {
      g = crear();
      geometrias.set(clave, g);
    }
    return g;
  };

  const limpiarArcada = () => {
    arcada.clear();
    piezasEnEscena.clear();
    for (const m of materiales) m.dispose();
    materiales.length = 0;
  };

  const marcarSeleccion = () => {
    for (const [tooth, grupo] of piezasEnEscena) {
      const elegida = tooth === seleccionada;
      grupo.scale.setScalar(elegida ? 1.12 : 1);
      const aro = grupo.getObjectByName("seleccion");
      if (aro) aro.visible = elegida;
    }
    pedirCuadro();
  };

  const matSeleccion = new MeshStandardMaterial({
    color: opciones.colorSeleccion,
    emissive: opciones.colorSeleccion,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });

  function actualizar(
    piezas: readonly number[],
    porPieza: ReadonlyMap<number, readonly OdontogramMark[]>,
  ) {
    limpiarArcada();
    for (const tooth of piezas) {
      const c = colocarPieza(tooth);
      const pintura = pinturaDePieza(porPieza.get(tooth) ?? []);
      const grupo = new Group();
      grupo.name = `pieza-${tooth}`;
      grupo.userData.tooth = tooth;
      grupo.userData.superior = c.superior;
      grupo.position.set(c.x, c.y, c.z);
      grupo.rotation.y = c.rotY;

      const fantasma = pintura.sinCorona;
      // Corona: seis caras, una por superficie (la cervical queda marfil).
      const caras = carasDeLaCorona(tooth);
      const mats = caras.map((cara) =>
        material(pintura.pieza ?? (cara ? pintura.caras[cara] : null), MARFIL, fantasma),
      );
      const corona = new Mesh(
        geo(`corona-${c.ancho}-${c.alto}-${c.grosor}`, () => {
          const r = Math.min(c.ancho, c.alto, c.grosor) * 0.22;
          return new RoundedBoxGeometry(c.ancho, c.alto, c.grosor, 3, r);
        }),
        mats,
      );
      corona.userData.tooth = tooth;
      grupo.add(corona);

      // Raíz: cono hacia el hueso (arriba en la superior, abajo en la inferior).
      const largoRaiz = c.alto * (c.tipo === "molar" ? 0.75 : 0.95);
      const raiz = new Mesh(
        geo(`raiz-${c.ancho}-${largoRaiz}`, () => new ConeGeometry(c.ancho * 0.36, largoRaiz, 18)),
        material(null, RAIZ, fantasma),
      );
      raiz.userData.tooth = tooth;
      const haciaHueso = c.superior ? 1 : -1;
      raiz.position.y = haciaHueso * (c.alto / 2 + largoRaiz / 2 - 0.05);
      raiz.rotation.x = c.superior ? Math.PI : 0;
      grupo.add(raiz);

      // Marca de pieza completa que no tapa la corona (endodoncia…): anillo cervical.
      if (pintura.cuello) {
        const anillo = new Mesh(
          geo(
            `cuello-${c.ancho}-${c.grosor}`,
            () => new TorusGeometry(Math.max(c.ancho, c.grosor) * 0.42, 0.045, 8, 28),
          ),
          material(pintura.cuello, MARFIL, false),
        );
        anillo.rotation.x = Math.PI / 2;
        anillo.position.y = haciaHueso * (c.alto / 2);
        anillo.userData.tooth = tooth;
        grupo.add(anillo);
      }

      // Aro de selección, oculto salvo en la pieza elegida.
      const aro = new Mesh(
        geo(
          `aro-${c.ancho}-${c.grosor}`,
          () => new TorusGeometry(Math.max(c.ancho, c.grosor) * 0.62, 0.035, 8, 36),
        ),
        matSeleccion,
      );
      aro.name = "seleccion";
      aro.rotation.x = Math.PI / 2;
      aro.position.y = -haciaHueso * (c.alto / 2 + 0.12);
      aro.visible = false;
      grupo.add(aro);

      arcada.add(grupo);
      piezasEnEscena.set(tooth, grupo);
    }
    aplicarVisibilidad();
    marcarSeleccion();
  }

  // Tocar sin arrastrar elige la pieza; arrastrar gira.
  const raycaster = new Raycaster();
  const puntero = new Vector2();
  const piezaBajo = (e: PointerEvent): number | null => {
    const r = canvas.getBoundingClientRect();
    puntero.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(puntero, camara);
    // Solo lo que se ve: en las vistas de una arcada la otra está oculta.
    const hit = raycaster
      .intersectObjects(arcada.children, true)
      .find((h) => h.object.visible && h.object.parent?.visible !== false);
    let o: Object3D | null = hit?.object ?? null;
    while (o && o.userData.tooth === undefined) o = o.parent;
    return o ? (o.userData.tooth as number) : null;
  };
  let inicio: { x: number; y: number } | null = null;
  let sobre: number | null = null;
  const alBajar = (e: PointerEvent) => {
    inicio = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  };
  const alSubir = (e: PointerEvent) => {
    if (!inicio || !e.isPrimary) return;
    const movio = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 6;
    inicio = null;
    if (movio) return;
    const tooth = piezaBajo(e);
    if (tooth !== null) opciones.alElegir(tooth);
  };
  const alMover = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || inicio) return;
    const tooth = piezaBajo(e);
    if (tooth === sobre) return;
    sobre = tooth;
    canvas.style.cursor = tooth === null ? "" : "pointer";
    opciones.alSobrevolar(tooth);
  };
  const alSalir = () => {
    sobre = null;
    opciones.alSobrevolar(null);
  };
  canvas.addEventListener("pointerdown", alBajar);
  canvas.addEventListener("pointerup", alSubir);
  canvas.addEventListener("pointermove", alMover);
  canvas.addEventListener("pointerleave", alSalir);

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

  // Distancia para que la boca entera (radio ~4,9) entre también en un teléfono vertical.
  const distancia = () => {
    const vertical = (camara.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camara.aspect);
    return Math.min(28, 4.9 / Math.sin(Math.min(vertical, horizontal) / 2));
  };
  let arcadaVisible: "ambas" | "superior" | "inferior" = "ambas";
  function aplicarVisibilidad() {
    for (const grupo of piezasEnEscena.values()) {
      const superior = grupo.userData.superior as boolean;
      grupo.visible = arcadaVisible === "ambas" || (arcadaVisible === "superior") === superior;
    }
  }
  const vista = (v: VistaOdonto) => {
    const d = distancia();
    const pos: Record<VistaOdonto, [number, number, number]> = {
      inicial: [0, d * 0.55, d * 0.84],
      frontal: [0, 0, d],
      // Un pelo corrido en Z: en el polo exacto la órbita queda indefinida.
      superior: [0, -d, d * 0.002], // mira la arcada superior desde abajo (oclusal)
      inferior: [0, d, d * 0.002], // mira la arcada inferior desde arriba (oclusal)
    };
    const [x, y, z] = pos[v];
    // En la vista de una arcada, la otra se oculta: si no, tapa a la que se quiere ver.
    arcadaVisible = v === "superior" ? "superior" : v === "inferior" ? "inferior" : "ambas";
    aplicarVisibilidad();
    controles.target.set(0, 0, CENTRO_Z);
    camara.position.set(x, y, z + CENTRO_Z);
    camara.lookAt(controles.target);
    controles.update();
    pedirCuadro();
  };

  redimensionar();
  vista("inicial");

  const esfericas = new Vector3();
  return {
    actualizar(piezas, porPieza) {
      actualizar(piezas, porPieza);
    },
    seleccionar(tooth) {
      seleccionada = tooth;
      marcarSeleccion();
    },
    vista,
    rotar(azimut, polar) {
      esfericas.copy(camara.position).sub(controles.target);
      const largo = esfericas.length();
      const theta = Math.atan2(esfericas.x, esfericas.z) + azimut;
      const phi = Math.min(Math.PI - 0.01, Math.max(0.01, Math.acos(esfericas.y / largo) + polar));
      camara.position.set(
        controles.target.x + largo * Math.sin(phi) * Math.sin(theta),
        controles.target.y + largo * Math.cos(phi),
        controles.target.z + largo * Math.sin(phi) * Math.cos(theta),
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
      canvas.removeEventListener("pointermove", alMover);
      canvas.removeEventListener("pointerleave", alSalir);
      controles.dispose();
      limpiarArcada();
      for (const g of geometrias.values()) g.dispose();
      matSeleccion.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
