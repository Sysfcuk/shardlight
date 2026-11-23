// The 3D world: a stone board on a floating rock in a crystal cavern, the gems, and every
// animation. main.js drives the game; this file draws it and animates moves.
//
// Performance on phones: cells, gems, rings and glows are all InstancedMeshes, so the whole
// board is a handful of draw calls no matter how many pieces are on it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gemGeometry, gemMaterial, wispGeometry } from './models.js';
import { createWorld, CRYSTAL_COLORS } from './world.js';
import { createSwarm } from './swarm.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Tilt-shift: blur that grows above and below a sharp band through the board, the look of a
// miniature photographed up close. Run twice (across, then down) for a cheap separable blur.
const TiltShift = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uFocus: { value: 0.5 }, uBand: { value: 0.2 }, uAmount: { value: 4 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uFocus; uniform float uBand; uniform float uAmount; uniform vec2 uRes; varying vec2 vUv;
    void main() {
      float r = smoothstep(uBand, uBand + 0.32, abs(vUv.y - uFocus)) * uAmount;
      if (r < 0.05) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 c = vec4(0.); float tw = 0.;
      for (int i = -4; i <= 4; i++) { float w = exp(-float(i * i) / 8.); c += texture2D(tDiffuse, vUv + uDir * float(i) * r / uRes) * w; tw += w; }
      gl_FragColor = c / tw;
    }`,
};

const S = 0.6;                    // cell circumradius (world units)
const SQ3 = Math.sqrt(3);
const EMPTY = 0, RUBY = 1, SAPPHIRE = 2;
const TAU = Math.PI * 2;
const REST_YAW = -Math.PI / 2;

const COLORS = {
  stone: new THREE.Color('#3b4157'),
  rubyCell: new THREE.Color('#6b1c2e'), sapphireCell: new THREE.Color('#1d3570'),
  // glows are added on top of the stone and pushed past white so the bloom picks them up
  rubyGlow: new THREE.Color('#ff1e4a').multiplyScalar(0.9), sapphireGlow: new THREE.Color('#2a6bff').multiplyScalar(0.9),
  buzz: new THREE.Color('#5dffb4'), fly: new THREE.Color('#c08cff'), hint: new THREE.Color('#ffc23a'), last: new THREE.Color('#ffffff'),
};

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const clamp01 = (u) => Math.min(1, Math.max(0, u));

// flat-topped cells: the whole board comes out taller than wide, which suits a portrait phone
export function axialToWorld(q, r) { return new THREE.Vector3(1.5 * S * q, 0, SQ3 * S * (r + q / 2)); }

export function createScene(canvas, { mobile = false } = {}) {
  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dprCap = mobile ? 1.75 : 2.5;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // ---------------------------------------------------------------- cavern light
  // Deep blue-violet darkness, a cool daylight shaft from the skylight straight down onto the
  // board (the key light, with shadows), and coloured light from the crystals (world.js).
  const CAVE = new THREE.Color('#0b0d18');
  scene.background = CAVE;
  scene.fog = new THREE.Fog('#10142a', 30, 95);
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight('#7d8cc7', '#1a1024', 0.42));
  const sun = new THREE.DirectionalLight('#e8f1ff', 2.3); // the skylight
  sun.position.set(1.5, 20, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const clouds = { children: [] }; // (no clouds underground)

  // ---------------------------------------------------------------- textures
  const radialTex = (inner = 'rgba(255,255,255,1)') => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  };
  const glowTex = radialTex();

  // ---------------------------------------------------------------- the world around the board, and post effects
  const world = createWorld(scene, { mobile });
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // bloom makes the crystals, gems and owned cells glow
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), mobile ? 0.6 : 0.8, 0.5, 0.94);
  composer.addPass(bloom);
  const tiltH = new ShaderPass(TiltShift), tiltV = new ShaderPass(TiltShift);
  tiltV.uniforms.uDir.value.set(0, 1);
  composer.addPass(tiltH); composer.addPass(tiltV);
  composer.addPass(new OutputPass());
  const blurPx = mobile ? 3 : 4.5;

  // ---------------------------------------------------------------- shared geometry/materials
  const hexShape = (r) => {
    const s = new THREE.Shape();
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; const x = Math.cos(a) * r, y = Math.sin(a) * r; k ? s.lineTo(x, y) : s.moveTo(x, y); }
    s.closePath();
    return s;
  };
  const CELL_H = 0.32;
  const cellGeo = new THREE.ExtrudeGeometry(hexShape(S * 0.88), { depth: CELL_H, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.055, bevelSegments: 3 });
  cellGeo.rotateX(-Math.PI / 2); cellGeo.translate(0, -(CELL_H + 0.06), 0);
  // polished dark stone, tinted per cell by who owns it
  const cellMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.05, envMapIntensity: 1.2 });
  const glowGeo = new THREE.CircleGeometry(S * 0.86, 6); glowGeo.rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ringGeo = new THREE.RingGeometry(S * 0.42, S * 0.56, 40); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
  // the gems: refractive crystal on desktop, glossy glowing stone on phones
  const rubyMat = gemMaterial('#e0143c', { rich: !mobile });
  const sapphireMat = gemMaterial('#1f5ae6', { rich: !mobile });
  const GEO = { gem: gemGeometry(8) };
  // glowing wisps drift round the cavern (boids), and gather at the sapphire rock now and then
  const wispMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const swarm = createSwarm(scene, { count: mobile ? 18 : 32, bodyGeo: wispGeometry(), bodyMat: wispMat, home: world.homePos, scale: 0.22, maxSpeed: 2.4, lift: 0,
    colors: ['#9ff7ff', '#ffe08a', '#d6b4ff', '#aaffd5'] });

  // ---------------------------------------------------------------- board state
  const board = new THREE.Group();
  scene.add(board);
  let island = null;
  let cells = [];          // [{ pos: Vector3 }]
  let n = 0;
  let meshes = null;       // instanced meshes for this board
  let actors = [];         // one per cell: what stands there and how it's animated
  let flyers = [];         // pieces in the air
  let cellCol = [], cellTarget = [], glowCol = [], glowTarget = [];
  let sel = -1, targets = [], hint = null, lastMove = null, thinking = -1;
  let speed = 1, clockT = 0, gen = 0; // gen changes with every new board, cancelling old animations

  const actor = (type, i) => ({ type, yaw: REST_YAW + (Math.random() - 0.5) * 0.9, jitter: (Math.random() - 0.5) * 0.9, lift: 0, scale: 0, hopAt: -9, spinAt: -9, swapTo: 0, phase: Math.random() * 10, i });

  function buildIsland(maxR) {
    if (island) { board.remove(island); island.traverse((o) => o.geometry?.dispose()); }
    island = new THREE.Group();
    // a slab of carved dark stone a little bigger than the board
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(hexShape(maxR + S * 1.1), { depth: 0.45, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.18, bevelSegments: 4 }),
      new THREE.MeshStandardMaterial({ color: '#363b4f', roughness: 0.6, metalness: 0.1 }));
    base.geometry.rotateX(-Math.PI / 2); base.geometry.translate(0, -0.42 - 0.57, 0);
    base.receiveShadow = true; base.castShadow = true;
    island.add(base);
    // earthy rock underneath, tapering to a point
    const rockGeo = new THREE.CylinderGeometry(maxR + S * 1.05, 0.6, 5.5, 18, 6);
    const p = rockGeo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      if (y > 2.7) continue;
      const j = 1 + (Math.sin(k * 12.9898) * 43758.5453 % 1) * 0.18;
      p.setX(k, p.getX(k) * j); p.setZ(k, p.getZ(k) * j);
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#2b3043', roughness: 0.95, flatShading: true }));
    rock.position.y = -1.05 - 2.75;
    island.add(rock);
    // a thin glowing rune band around the slab
    const band = new THREE.Mesh(new THREE.TorusGeometry(maxR + S * 1.15, 0.05, 6, 96), new THREE.MeshBasicMaterial({ color: '#7fe7ff', toneMapped: false }));
    band.rotation.x = Math.PI / 2; band.position.y = -0.62;
    island.add(band);
    // crystal shards hanging under the rock, catching the light
    const shard = new THREE.MeshBasicMaterial({ color: '#9b6bff', toneMapped: false });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + 0.3, r = maxR * 0.55 + (k % 3) * 0.5, len = 0.6 + (k % 3) * 0.5;
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.14, len, 6), shard);
      d.rotation.x = Math.PI; d.position.set(Math.cos(a) * r, -4.2 - len / 2 + (r / maxR) * 2.2, Math.sin(a) * r);
      island.add(d);
    }
    board.add(island);
  }

  function setBoard(cellList, pieces) {
    gen++;
    if (meshes) for (const m of Object.values(meshes)) { board.remove(m); m.dispose?.(); }
    n = cellList.length;
    cells = cellList.map(({ q, r }) => ({ pos: axialToWorld(q, r) }));
    let maxR = 0;
    for (const c of cells) maxR = Math.max(maxR, c.pos.length());
    buildIsland(maxR);
    world.setBoardRadius(maxR, maxR + S * 1.15);
    swarm.setRadius(maxR + 1.5);
    const cap = n + 8;
    meshes = {
      cells: new THREE.InstancedMesh(cellGeo, cellMat, n),
      glow: new THREE.InstancedMesh(glowGeo, glowMat, n),
      rings: new THREE.InstancedMesh(ringGeo, ringMat, 24),
      ruby: new THREE.InstancedMesh(GEO.gem, rubyMat, cap),
      sapphire: new THREE.InstancedMesh(GEO.gem, sapphireMat, cap),
    };
    meshes.cells.receiveShadow = true;
    for (const k of ['ruby', 'sapphire']) meshes[k].castShadow = true;
    for (const m of Object.values(meshes)) { m.frustumCulled = false; board.add(m); }
    meshes.glow.renderOrder = 1; meshes.rings.renderOrder = 2;
    const mtx = new THREE.Matrix4();
    cellCol = []; cellTarget = []; glowCol = []; glowTarget = [];
    for (let i = 0; i < n; i++) {
      mtx.makeTranslation(cells[i].pos.x, 0, cells[i].pos.z);
      meshes.cells.setMatrixAt(i, mtx);
      mtx.makeTranslation(cells[i].pos.x, 0.012, cells[i].pos.z);
      meshes.glow.setMatrixAt(i, mtx);
      cellCol.push(COLORS.stone.clone()); cellTarget.push(COLORS.stone.clone());
      glowCol.push(new THREE.Color(0)); glowTarget.push(new THREE.Color(0));
      meshes.cells.setColorAt(i, cellCol[i]);
      meshes.glow.setColorAt(i, glowCol[i]);
    }
    meshes.rings.setColorAt(0, COLORS.buzz);
    meshes.rings.count = 0;
    actors = pieces.map((t, i) => {
      const a = actor(t, i);
      a.scale = 0; a.appearAt = clockT + 0.25 + i * 0.012; // pop in across the board
      return a;
    });
    flyers = []; sel = -1; targets = []; hint = null; lastMove = null;
    fit();
  }

  // ---------------------------------------------------------------- camera
  let view = 'play';
  const look = new THREE.Vector3(0, 0, 0);
  const tilt = { x: 0, y: 0, wx: 0, wy: 0 };
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    tilt.wx = Math.max(-1, Math.min(1, e.gamma / 30)); tilt.wy = Math.max(-1, Math.min(1, (e.beta - 50) / 35));
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tilt.wx = (e.clientX / innerWidth - 0.5) * 0.8; tilt.wy = (e.clientY / innerHeight - 0.5) * 0.8;
  }, { passive: true });

  // The play camera orbits the board: drag to turn and tilt it, pinch (or scroll) to zoom.
  // The board always fits whichever way it's turned, because the fit uses its radius.
  const ELEV0 = 1.0;                       // default tilt: a little lower than straight down, so it reads as 3D
  const orbit = { yaw: 0, elev: ELEV0, zoom: 1, vyaw: 0, velev: 0, resetting: false, dragging: false };
  let camDist = 20, padTop = 0, padBottom = 0, lookShift = 0, onViewChange = null;
  const isDefaultView = () => Math.abs(orbit.yaw) < 0.05 && Math.abs(orbit.elev - ELEV0) < 0.05 && Math.abs(orbit.zoom - 1) < 0.05;
  function fit() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    camera.aspect = w / h;
    let maxR = 1;
    for (const c of cells) maxR = Math.max(maxR, c.pos.length());
    // a cell reaches S beyond its centre, and the wax slab under the board another ~S past that
    const half = maxR + S * 1.9;
    const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    // leave room for the HUD bars: the board fits the band between them
    const usable = Math.max(0.5, 1 - (padTop + padBottom) / h);
    const dW = half / Math.tan(hfov / 2);
    const dH = (half * Math.sin(ELEV0) + 0.8) / (Math.tan(vfov / 2) * usable);
    camDist = Math.max(dW, dH) * 1.02;
    // shift the view so the board centres in the free band between the bars
    lookShift = ((padTop - padBottom) / h) * 2 * Math.tan(vfov / 2) * camDist * 0.45;
    camera.updateProjectionMatrix();
  }

  function placeCamera(dt) {
    tilt.x += (tilt.wx - tilt.x) * Math.min(1, dt * 2.5);
    tilt.y += (tilt.wy - tilt.y) * Math.min(1, dt * 2.5);
    if (view === 'title') {
      const a = clockT * 0.07;
      const d = camDist * 1.08, e = 0.62;
      camera.position.set(Math.sin(a) * d * Math.cos(e), d * Math.sin(e) + 1, Math.cos(a) * d * Math.cos(e));
      camera.lookAt(0, -0.8, 0);
      camAzimuth = a;
      scene.fog.near = d + 4; scene.fog.far = d + 70;
      return;
    }
    if (orbit.resetting) {
      const k = Math.min(1, dt * 6);
      orbit.yaw += (Math.atan2(Math.sin(-orbit.yaw), Math.cos(-orbit.yaw))) * k;
      orbit.elev += (ELEV0 - orbit.elev) * k; orbit.zoom += (1 - orbit.zoom) * k;
      if (isDefaultView()) { orbit.yaw = 0; orbit.elev = ELEV0; orbit.zoom = 1; orbit.resetting = false; }
    } else if (!orbit.dragging) {
      // a flick keeps turning for a moment
      orbit.yaw += orbit.vyaw * dt; orbit.elev = clampElev(orbit.elev + orbit.velev * dt);
      const f = Math.exp(-dt * 4); orbit.vyaw *= f; orbit.velev *= f;
    }
    const yaw = orbit.yaw + tilt.x * 0.12, e = clampElev(orbit.elev - tilt.y * 0.05), d = camDist * orbit.zoom;
    const s = lookShift * orbit.zoom;
    look.set(-Math.sin(yaw) * s, 0, -Math.cos(yaw) * s);
    camera.position.set(look.x + Math.sin(yaw) * d * Math.cos(e), d * Math.sin(e), look.z + Math.cos(yaw) * d * Math.cos(e));
    camera.lookAt(look);
    camAzimuth = yaw;
    // fog starts just past the board, wherever the camera is, so zooming out never washes it out
    const cd = camera.position.length(); scene.fog.near = cd + 4; scene.fog.far = cd + 70;
  }
  let camAzimuth = 0;
  const clampElev = (e) => Math.min(1.28, Math.max(0.45, e)); // never quite flat-on, never below the rim

  // ---------------------------------------------------------------- gestures
  // One finger drags the view; a short touch that barely moves is a tap (handed to onTap).
  // Two fingers pinch to zoom. The mouse wheel zooms too.
  const touches = new Map();
  let gesture = null, onTap = null, pinchD = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) gesture = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, multi: false, lx: e.clientX, ly: e.clientY, lt: performance.now() };
    else if (gesture) { gesture.multi = true; const [a, b] = [...touches.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
    orbit.vyaw = orbit.velev = 0; orbit.resetting = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId);
    if (!p || !gesture || view !== 'play') return;
    p.x = e.clientX; p.y = e.clientY;
    if (touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0) orbit.zoom = Math.min(1.8, Math.max(0.55, orbit.zoom * (pinchD / d)));
      pinchD = d; gesture.moved = true; changed();
      return;
    }
    if (!gesture.moved && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) < 9) return;
    gesture.moved = true; orbit.dragging = true;
    const now = performance.now(), dx = e.clientX - gesture.lx, dy = e.clientY - gesture.ly, dts = Math.max(0.001, (now - gesture.lt) / 1000);
    orbit.yaw -= dx * 0.0075;
    orbit.elev = clampElev(orbit.elev + dy * 0.0032);
    orbit.vyaw = orbit.vyaw * 0.5 + (-dx * 0.0075 / dts) * 0.5;
    orbit.velev = orbit.velev * 0.5 + (dy * 0.0032 / dts) * 0.5;
    gesture.lx = e.clientX; gesture.ly = e.clientY; gesture.lt = now;
    changed();
  });
  const release = (e) => {
    const had = touches.delete(e.pointerId);
    if (!had || !gesture) return;
    if (touches.size === 0) {
      const tap = !gesture.moved && !gesture.multi && performance.now() - gesture.t0 < 700;
      // a slow release shouldn't fling
      if (performance.now() - gesture.lt > 90) orbit.vyaw = orbit.velev = 0;
      orbit.dragging = false; gesture = null; pinchD = 0;
      if (tap) onTap?.(e.clientX, e.clientY);
    } else pinchD = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (e) => { if (gesture) gesture.moved = true; release(e); });
  canvas.addEventListener('wheel', (e) => {
    if (view !== 'play') return;
    e.preventDefault();
    orbit.zoom = Math.min(1.8, Math.max(0.55, orbit.zoom * (1 + e.deltaY * 0.001)));
    changed();
  }, { passive: false });
  let wasDefault = true;
  function changed() { const d = isDefaultView(); if (d !== wasDefault) { wasDefault = d; onViewChange?.(!d); } }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    for (const p of [tiltH, tiltV]) { p.uniforms.uRes.value.set(w * pr, h * pr); p.uniforms.uAmount.value = blurPx * pr; }
    fit();
  }
  addEventListener('resize', resize);

  // ---------------------------------------------------------------- picking
  const tmpV = new THREE.Vector3();
  function toScreen(v) {
    tmpV.copy(v).project(camera);
    const r = canvas.getBoundingClientRect();
    return [(tmpV.x + 1) / 2 * r.width + r.left, (1 - tmpV.y) / 2 * r.height + r.top];
  }
  /** The cell under a screen point: compares against each cell's centre, or a piece's middle. */
  function pick(x, y) {
    if (!n) return -1;
    let best = -1, bd = Infinity;
    const a = toScreen(cells[0].pos), b = toScreen(tmpV.copy(cells[0].pos).add(new THREE.Vector3(S, 0, 0)));
    const radius = Math.hypot(a[0] - b[0], a[1] - b[1]) * 1.05;
    for (let i = 0; i < n; i++) {
      const p = cells[i].pos.clone();
      if (actors[i].type) p.y = 0.35;
      const [sx, sy] = toScreen(p);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = i; }
    }
    return bd < radius ? best : -1;
  }

  // ---------------------------------------------------------------- particles
  const PMAX = 700;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.11, map: radialTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.frustumCulled = false;
  scene.add(points);
  const pv = Array.from({ length: PMAX }, () => ({ life: 0, max: 0, vx: 0, vy: 0, vz: 0, c: new THREE.Color(), g: 1 }));
  let pNext = 0;
  function burst(pos, colors, count = 20, { up = 2.2, spread = 2.2, gravity = 1 } = {}) {
    for (let k = 0; k < count; k++) {
      const i = pNext; pNext = (pNext + 1) % PMAX;
      const p = pv[i];
      p.life = 0; p.max = 0.5 + Math.random() * 0.5; p.g = gravity;
      const a = Math.random() * TAU, s = spread * (0.4 + Math.random() * 0.6);
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = up * (0.5 + Math.random());
      p.c.set(colors[k % colors.length]);
      pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
    }
  }
  function stepParticles(dt) {
    for (let i = 0; i < PMAX; i++) {
      const p = pv[i];
      if (p.life >= p.max) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
      p.life += dt;
      p.vy -= 6 * p.g * dt; p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5;
      pPos[i * 3] += p.vx * dt; pPos[i * 3 + 1] += p.vy * dt; pPos[i * 3 + 2] += p.vz * dt;
      const f = 1 - p.life / p.max;
      pCol[i * 3] = p.c.r * f; pCol[i * 3 + 1] = p.c.g * f; pCol[i * 3 + 2] = p.c.b * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- animation helpers
  /** Wait in animation time (fast-forward shortens it); real-time based so background tabs finish too. */
  const wait = (ms) => new Promise((resolve) => {
    let left = ms, last = performance.now();
    const tick = () => { const now = performance.now(); left -= (now - last) * speed; last = now; left <= 0 ? resolve() : setTimeout(tick, 16); };
    tick();
  });

  function flight(type, from, to, { buzz, scaleFrom = 1 }) {
    return new Promise((resolve) => {
      const a = cells[from].pos, b = cells[to].pos;
      const f = { type, a, b, el: 0, dur: buzz ? 0.32 : 0.46, arc: buzz ? 0.75 : 1.6, scaleFrom, yaw: Math.atan2(-(b.z - a.z), b.x - a.x), last: performance.now(), done: null };
      let finished = false;
      f.done = () => { if (finished) return; finished = true; flyers.splice(flyers.indexOf(f), 1); resolve(); };
      flyers.push(f);
      setTimeout(f.done, f.dur * 1000 + 300);
    });
  }

  // ---------------------------------------------------------------- public animation API
  const sideType = (side) => (side === 0 ? RUBY : SAPPHIRE);
  const sideColors = (side) => (side === 0 ? ['#ff2d55', '#ffd0da', '#ff8aa0'] : ['#3d7bff', '#cfe0ff', '#7fb0ff']);

  async function playMove(res, side, sfx = {}) {
    const type = sideType(side), { move } = res;
    const my = gen, stale = () => my !== gen;
    sel = -1; targets = []; hint = null;
    lastMove = { from: move.from, to: move.to, at: clockT };
    const src = actors[move.from];
    if (!move.buzz) src.type = EMPTY;
    else src.hopAt = clockT; // the original gives a little push-off
    sfx.fly?.(side, move.buzz);
    await flight(type, move.from, move.to, { buzz: move.buzz, scaleFrom: move.buzz ? 0.55 : 1 });
    if (stale()) return;
    const dst = actors[move.to];
    Object.assign(dst, { type, scale: 1, hopAt: clockT, yaw: Math.atan2(-(cells[move.to].pos.z - cells[move.from].pos.z), cells[move.to].pos.x - cells[move.from].pos.x) });
    sfx.land?.(side);
    burst(tmpV.copy(cells[move.to].pos).setY(0.1), ['#fff3c0'], 8, { up: 1, spread: 1.4, gravity: 0.3 });
    // neighbours switch sides: a hop and a spin, swapping half way round
    for (let k = 0; k < res.flips.length; k++) {
      const a = actors[res.flips[k]];
      a.spinAt = clockT; a.swapTo = type; a.hopAt = clockT;
      setTimeout(() => burst(tmpV.copy(cells[a.i].pos).setY(0.45), sideColors(side), 18), 120 / speed);
      sfx.flip?.(side, k);
      await wait(70);
      if (stale()) return;
    }
    // a big capture brings the swarm sweeping over
    if (res.flips.length >= 3) swarm.swoop(cells[move.to].pos, clockT);
    if (res.flips.length) await wait(300);
    if (stale()) return;
    if (res.over && res.filled.length) {
      await wait(200);
      const ft = sideType(res.filledBy);
      for (let k = 0; k < res.filled.length; k++) {
        const a = actors[res.filled[k]];
        Object.assign(a, { type: ft, scale: 0, appearAt: clockT, hopAt: clockT });
        sfx.fill?.(k);
        await wait(45);
        if (stale()) return;
      }
      await wait(250);
    }
  }

  function celebrate(winnerSide) {
    const t = sideType(winnerSide);
    actors.forEach((a, k) => { if (a.type === t) { a.hopAt = clockT + (k % 9) * 0.06; a.cheer = clockT; } });
    // the wisps circle over the winning side's territory (or the middle for a draw)
    const mid = new THREE.Vector3(); let cnt = 0;
    actors.forEach((a, i) => { if (a.type === t) { mid.add(cells[i].pos); cnt++; } });
    swarm.celebrate(cnt ? mid.divideScalar(cnt) : mid.set(0, 0, 0), clockT);
    const colors = winnerSide === 0 ? ['#ffd23f', '#ff7aa2', '#ffffff', '#9b7bff'] : ['#ff6a1a', '#ffd000', '#d4141c'];
    for (let k = 0; k < 6; k++) setTimeout(() => {
      const c = cells[(Math.random() * n) | 0].pos;
      burst(tmpV.set(c.x, 2.5, c.z), colors, 40, { up: 1.5, spread: 3, gravity: 0.35 });
    }, k * 160);
  }

  // ---------------------------------------------------------------- per-frame
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler();
  const AX_Y = new THREE.Vector3(0, 1, 0);
  let last = performance.now();

  function poseMatrix(out, x, y, z, yaw, sx, sy, sz, roll = 0) {
    E.set(0, yaw, roll, 'YXZ'); Q.setFromEuler(E);
    return out.compose(P.set(x, y, z), Q, SC.set(sx, sy, sz));
  }

  /** Pose a gem: hovering at height y, turning (yaw), and tumbling end over end (tumble, radians). */
  const GEM_SIZE = 1.22;
  function gemMatrix(out, x, y, z, yaw, tumble, s) {
    E.set(tumble, yaw, 0, 'YXZ'); Q.setFromEuler(E);
    // tumble about the gem's middle, not its point
    const k = s * GEM_SIZE, mid = 0.3 * k;
    P.set(0, mid, 0).applyQuaternion(Q);
    return out.compose(P.set(x - P.x, y + mid - P.y, z - P.z), Q, SC.set(k, k, k));
  }

  // If frames stay slow (an older phone), drop the blur and render at a lower resolution.
  let frameEma = 1 / 60, watchT = 0, lowered = false;
  function watchPerformance(rdt) {
    if (lowered || document.hidden) return;
    watchT += rdt;
    if (watchT < 2) return; // ignore start-up hiccups (shaders compiling)
    frameEma += (rdt - frameEma) * 0.05;
    if (watchT > 6 && frameEma > 1 / 34) {
      lowered = true;
      tiltH.enabled = tiltV.enabled = false;
      bloom.strength *= 0.6;
      renderer.setPixelRatio(Math.min(1.25, devicePixelRatio || 1));
      resize();
    }
  }
  function update(now) {
    const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    watchPerformance(rdt);
    const dt = rdt * speed;
    clockT += dt;
    const t = clockT;
    placeCamera(rdt);
    for (const c of clouds.children) { c.position.x += c.userData.speed * rdt; if (c.position.x > 70) c.position.x = -70; }
    if (meshes) {
      // cells drift towards their owner's colour; the glow follows
      const glowOn = sel >= 0 ? 0.55 : 1;
      for (let i = 0; i < n; i++) {
        const a = actors[i];
        const owner = a.spinAt > t - 0.45 && a.swapTo ? a.swapTo : a.type;
        cellTarget[i].copy(owner === RUBY ? COLORS.rubyCell : owner === SAPPHIRE ? COLORS.sapphireCell : COLORS.stone);
        if (owner === RUBY) glowTarget[i].copy(COLORS.rubyGlow); else if (owner === SAPPHIRE) glowTarget[i].copy(COLORS.sapphireGlow); else glowTarget[i].setRGB(0, 0, 0);
        glowTarget[i].multiplyScalar(glowOn * (0.85 + 0.15 * Math.sin(t * 1.6 + i * 0.7))); // a slow shimmer
        if (i === sel) glowTarget[i].setRGB(0.7, 0.75, 0.9);
        cellCol[i].lerp(cellTarget[i], Math.min(1, rdt * 5));
        glowCol[i].lerp(glowTarget[i], Math.min(1, rdt * 5));
        meshes.cells.setColorAt(i, cellCol[i]);
        meshes.glow.setColorAt(i, glowCol[i]);
      }
      meshes.cells.instanceColor.needsUpdate = true;
      meshes.glow.instanceColor.needsUpdate = true;

      // rings: targets, hint, and the last move's landing
      let r = 0;
      const ring = (i, color, scale, y = 0.02) => {
        const c = cells[i].pos;
        M.compose(P.set(c.x, y, c.z), Q.identity(), SC.set(scale, 1, scale));
        meshes.rings.setMatrixAt(r, M); meshes.rings.setColorAt(r, color); r++;
      };
      const pulse = 1 + Math.sin(t * 7) * 0.06;
      for (const tg of targets) ring(tg.to, tg.fly ? COLORS.fly : COLORS.buzz, (tg.fly ? 0.82 : 1) * pulse);
      if (hint) { ring(hint.from, COLORS.hint, 1.15 + Math.sin(t * 6) * 0.08); ring(hint.to, COLORS.hint, 1.25 + Math.sin(t * 6) * 0.1); }
      if (lastMove && t - lastMove.at < 1.6 && sel < 0) ring(lastMove.to, new THREE.Color(1, 1, 1).multiplyScalar(1 - (t - lastMove.at) / 1.6), 1.1);
      meshes.rings.count = r;
      meshes.rings.instanceMatrix.needsUpdate = true;
      if (meshes.rings.instanceColor) meshes.rings.instanceColor.needsUpdate = true;

      // gems: hover over their cells and slowly turn; the side that's thinking turns faster
      let nr = 0, ns = 0;
      for (let i = 0; i < n; i++) {
        const a = actors[i];
        // a captured gem tumbles end over end and changes colour half way
        const spin = clamp01((t - a.spinAt) / 0.5);
        if (a.swapTo && spin >= 0.5) { a.type = a.swapTo; a.swapTo = 0; }
        if (!a.type) continue;
        if (a.appearAt !== undefined) { if (t < a.appearAt) continue; a.scale += (1 - a.scale) * Math.min(1, rdt * 9); if (a.scale > 0.995) { a.scale = 1; a.appearAt = undefined; } }
        const c = cells[i].pos;
        const selected = i === sel;
        a.lift += ((selected ? 0.38 : 0) - a.lift) * Math.min(1, rdt * 10);
        const thinkingSide = thinking >= 0 && sideType(thinking) === a.type;
        a.yaw += dt * (selected ? 2.6 : thinkingSide ? 1.4 : 0.45);
        const hopU = clamp01((t - a.hopAt) / 0.42);
        const hop = hopU < 1 ? Math.sin(hopU * Math.PI) * 0.4 : 0;
        const cheer = a.cheer && t - a.cheer < 2.2 ? Math.abs(Math.sin((t - a.cheer) * 9 + a.phase)) * 0.25 : 0;
        const hover = 0.08 + Math.sin(t * 1.8 + a.phase) * 0.04;
        const tumble = spin < 1 ? ease(spin) * TAU : 0;
        gemMatrix(M, c.x, hover + a.lift + hop + cheer, c.z, a.yaw, tumble, a.scale);
        if (a.type === RUBY) meshes.ruby.setMatrixAt(nr++, M); else meshes.sapphire.setMatrixAt(ns++, M);
      }
      // gems in flight
      for (const f of [...flyers]) {
        f.el += (performance.now() - f.last) / 1000 * speed; f.last = performance.now();
        const u = clamp01(f.el / f.dur), e = ease(u);
        const x = f.a.x + (f.b.x - f.a.x) * e, z = f.a.z + (f.b.z - f.a.z) * e, y = 0.08 + Math.sin(u * Math.PI) * f.arc;
        const s = f.scaleFrom + (1 - f.scaleFrom) * e;
        gemMatrix(M, x, y, z, f.yaw + u * TAU, Math.sin(u * Math.PI) * 0.6, s);
        if (f.type === RUBY) meshes.ruby.setMatrixAt(nr++, M); else meshes.sapphire.setMatrixAt(ns++, M);
        if (u >= 1) f.done();
      }
      meshes.ruby.count = nr; meshes.sapphire.count = ns;
      meshes.ruby.instanceMatrix.needsUpdate = meshes.sapphire.instanceMatrix.needsUpdate = true;
    }
    stepParticles(dt);
    world.update(clockT, rdt);
    swarm.update(Math.min(dt, 0.033), clockT);
    // the sun's shadow box follows the board
    sun.shadow.camera.left = sun.shadow.camera.bottom = -9; sun.shadow.camera.right = sun.shadow.camera.top = 9;
    sun.shadow.camera.updateProjectionMatrix();
    // keep the sharp band on the board
    tmpV.set(0, 0, 0).project(camera);
    tiltH.uniforms.uFocus.value = tiltV.uniforms.uFocus.value = (tmpV.y + 1) / 2;
    composer.render();
  }
  const loop = (now) => { update(now); requestAnimationFrame(loop); };
  resize();
  requestAnimationFrame(loop);

  return {
    setBoard,
    resize,
    pick,
    playMove,
    celebrate,
    /** Highlight a piece and its targets ([{to, fly}]). */
    select(i, list) { sel = i; targets = list || []; if (i >= 0) actors[i].hopAt = clockT; },
    clearSelect() { sel = -1; targets = []; },
    setHint(h) { hint = h; },
    setThinking(side) { thinking = side; },
    /** 'title' slowly circles the island; 'play' frames the board for the HUD. */
    setView(v, pads = {}) { view = v; padTop = pads.top || 0; padBottom = pads.bottom || 0; fit(); },
    /** Called with (clientX, clientY) for a tap that wasn't a drag or pinch. */
    onTap(fn) { onTap = fn; },
    /** Called with true when the player has turned/zoomed away from the default view, false when back. */
    onViewChange(fn) { onViewChange = fn; },
    /** Glide back to the default view. */
    resetView(instant = false) {
      orbit.vyaw = orbit.velev = 0;
      if (instant) Object.assign(orbit, { yaw: 0, elev: ELEV0, zoom: 1, resetting: false }); else orbit.resetting = true;
      wasDefault = true; onViewChange?.(false);
    },
    set speed(v) { speed = v; },
    get speed() { return speed; },
    /** Settle every piece to match the engine (after undo). */
    sync(pieces) { pieces.forEach((t, i) => { const a = actors[i]; a.type = t; a.swapTo = 0; a.spinAt = -9; a.scale = 1; a.appearAt = undefined; }); flyers = []; },
    burstAt(i, colors) { burst(tmpV.copy(cells[i].pos).setY(0.4), colors, 16); },
    /** Where a cell is on screen (CSS px), e.g. for tests that tap it. */
    screenOf(i) { return toScreen(cells[i].pos); },
    debug() { return { pos: camera.position.toArray(), camDist, look: look.toArray(), aspect: camera.aspect, view, tilt: { ...tilt } }; },
    /** A PNG of the current frame (dev/testing). */
    snapshot() { update(performance.now()); return new Promise((r) => canvas.toBlob(r, 'image/png')); },
  };
}
