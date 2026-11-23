// The crystal cavern around the board: a dark rock dome with stalactites and stalagmites, glowing
// crystal clusters (with a few coloured lights), floating rocks crowned with ruby and sapphire
// formations on either side of the board, an underground lake, and a shaft of daylight falling
// from a skylight onto the board, full of drifting dust.
// Everything is built in code; repeated things (spikes, crystals) are instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const rand = (() => { let s = 7654321; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); // repeatable layout
const FLOOR = -12;

export const CRYSTAL_COLORS = { ruby: '#ff2d55', sapphire: '#3d7bff', amethyst: '#b05cff', teal: '#2de0d0', amber: '#ffb03a' };

function jitter(geo, amount, keep = () => false) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (keep(p.getX(i), p.getY(i), p.getZ(i))) continue;
    const j = 1 + (rand() - 0.5) * amount;
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * (1 + (rand() - 0.5) * amount * 0.5), p.getZ(i) * j);
  }
  geo.computeVertexNormals();
  return geo;
}

/** One crystal: a six-sided prism with a pointed tip, brighter towards the tip. Base at y = 0, height 1. */
function crystalGeo() {
  const prism = new THREE.CylinderGeometry(0.16, 0.2, 0.75, 6, 1);
  prism.translate(0, 0.375, 0);
  const tip = new THREE.ConeGeometry(0.16, 0.25, 6, 1);
  tip.translate(0, 0.875, 0);
  const g = mergeGeometries([prism.toNonIndexed(), tip.toNonIndexed()]);
  g.deleteAttribute('uv');
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = 0.35 + 0.65 * Math.min(1, p.getY(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function createWorld(scene, { mobile = false } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#2a2f42', roughness: 0.95, flatShading: true });
  const darkRock = new THREE.MeshStandardMaterial({ color: '#1a1d2b', roughness: 1, flatShading: true });

  // ---------------------------------------------------------- the cavern
  const dome = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(62, 3), 0.18), new THREE.MeshStandardMaterial({ color: '#0e1019', roughness: 1, flatShading: true, side: THREE.BackSide }));
  dome.scale.set(1, 0.55, 1); dome.position.y = 8;
  root.add(dome);
  // the floor and an underground lake
  const floor = new THREE.Mesh(jitter(new THREE.CircleGeometry(70, 40, 0, TAU), 0.05), darkRock);
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR;
  root.add(floor);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: '#0d2a3a', roughness: 0.04, metalness: 0.4, emissive: '#0a3b4a', emissiveIntensity: 0.22, envMapIntensity: 1.2 }));
  lake.rotation.x = -Math.PI / 2; lake.position.set(4, FLOOR + 0.05, 3); lake.scale.set(1.3, 1, 1);
  root.add(lake);

  // stalactites from the ceiling, stalagmites from the floor
  const spike = jitter(new THREE.ConeGeometry(1, 1, 7, 3), 0.25, (x, y) => y > 0.49);
  const SPIKES = mobile ? 40 : 80;
  const spikes = new THREE.InstancedMesh(spike, rockMat, SPIKES);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  for (let k = 0; k < SPIKES; k++) {
    const a = rand() * TAU, len = 3 + rand() * 9, r = 0.6 + rand() * 1.4;
    // hanging ones stay out past the camera's paths (it orbits ~32 out at the title and glides
    // between views), so it never flies through one; floor ones can come closer
    const d = k % 2 ? 40 + rand() * 18 : 14 + rand() * 40;
    if (k % 2) { v.set(Math.cos(a) * d, 30 - len / 2 - rand() * 4, Math.sin(a) * d); q.copy(down); } // hanging
    else { v.set(Math.cos(a) * d, FLOOR + len / 2, Math.sin(a) * d); q.identity(); }
    spikes.setMatrixAt(k, m4.compose(v, q, s.set(r, len, r)));
  }
  root.add(spikes);

  // ---------------------------------------------------------- crystals (one instanced mesh, coloured per crystal)
  const CRYSTALS = mobile ? 160 : 300;
  const crystals = new THREE.InstancedMesh(crystalGeo(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.92 }), CRYSTALS);
  crystals.frustumCulled = false;
  root.add(crystals);
  let crystalN = 0;
  const followers = []; // crystals that ride on a floating rock: { i, rock, local }
  function cluster(x, y, z, color, count, size, rock = null) {
    const col = new THREE.Color(color);
    for (let k = 0; k < count && crystalN < CRYSTALS; k++) {
      const a = rand() * TAU, d = rand() * size * 0.5;
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 1.0, rand() * TAU, (rand() - 0.5) * 1.0));
      const h = size * (0.5 + rand() * 0.9);
      const local = new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * d, y, z + Math.sin(a) * d), tilt, new THREE.Vector3(h * 0.9, h, h * 0.9));
      if (rock) followers.push({ i: crystalN, rock, local });
      crystals.setMatrixAt(crystalN, rock ? local.clone().premultiply(rock.matrixWorld) : local);
      crystals.setColorAt(crystalN, col.clone().multiplyScalar(0.85 + rand() * 0.4));
      crystalN++;
    }
  }
  // crystal lights: a few coloured lights so the glow actually lights the rock
  const lights = [];
  function crystalLight(x, y, z, color, intensity = 40) {
    const l = new THREE.PointLight(color, intensity, 22, 2);
    l.position.set(x, y, z);
    root.add(l); lights.push(l);
    return l;
  }

  // ---------------------------------------------------------- floating rocks
  const floaters = [];
  function floater(r, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const geo = jitter(new THREE.CylinderGeometry(r, r * 0.1, r * 1.8, 8, 3), 0.25, (x2, y2) => y2 > r * 0.89);
    geo.translate(0, -r * 0.9, 0);
    const m = new THREE.Mesh(geo, rockMat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    g.userData = { y0: y, phase: rand() * TAU, spin: (rand() - 0.5) * 0.05 };
    root.add(g); floaters.push(g);
    g.updateMatrixWorld(true);
    return g;
  }

  // ---------------------------------------------------------- the skylight: a shaft of daylight onto the board
  const shaftTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(235,245,255,.75)'); gr.addColorStop(0.7, 'rgba(210,230,255,.25)'); gr.addColorStop(1, 'rgba(210,230,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
    // soft vertical streaks
    for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.04})`; g.fillRect(rand() * 128, 0, 2 + rand() * 6, 256); }
    return new THREE.CanvasTexture(c);
  })();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 5.2, 34, 32, 1, true), new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  shaft.position.y = 16;
  root.add(shaft);
  const skylight = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ color: '#f4fbff', toneMapped: false, fog: false }));
  skylight.rotation.x = Math.PI / 2; skylight.position.y = 33;
  root.add(skylight);
  // dust motes drifting in the light
  const DUST = mobile ? 160 : 320;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(DUST * 3), dSeed = new Float32Array(DUST);
  for (let k = 0; k < DUST; k++) { const a = rand() * TAU, d = Math.sqrt(rand()) * 6.5; dp[k * 3] = Math.cos(a) * d; dp[k * 3 + 1] = rand() * 14 - 1; dp[k * 3 + 2] = Math.sin(a) * d; dSeed[k] = rand() * TAU; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.07, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#dfeaff', toneMapped: false }));
  dust.frustumCulled = false;
  root.add(dust);

  const homePos = new THREE.Vector3();

  /** Lay the cavern out around a board of radius maxR. Called per board. */
  function setBoardRadius(maxR, rimR) {
    for (const f of floaters) root.remove(f);
    for (const l of lights) root.remove(l);
    floaters.length = 0; lights.length = 0; followers.length = 0; crystalN = 0;
    const R = maxR + 1.6;
    // the rubies' rock and the sapphires' rock face each other across the board
    const ruby = floater(1.5, -(R + 3), -0.8, -1.6);
    cluster(0, 0, 0, CRYSTAL_COLORS.ruby, 9, 1.5, ruby);
    const sapph = floater(1.5, R + 3, -0.6, 1.4);
    cluster(0, 0, 0, CRYSTAL_COLORS.sapphire, 9, 1.5, sapph);
    crystalLight(ruby.position.x, ruby.position.y + 1.5, ruby.position.z, CRYSTAL_COLORS.ruby, mobile ? 30 : 45);
    crystalLight(sapph.position.x, sapph.position.y + 1.5, sapph.position.z, CRYSTAL_COLORS.sapphire, mobile ? 30 : 45);
    const others = [[1.1, -(R + 1), -3.4, R + 2.8, 'amethyst'], [0.9, R + 1.6, -2.8, -(R + 2), 'teal'], [1.2, 1.2, -4.6, R + 4.8, 'amber'], [0.8, -1.8, -2.2, -(R + 4.4), 'teal'], [1.0, -(R + 5.6), -5.6, R + 1.2, 'amethyst']];
    for (const [r, x, y, z, col] of others.slice(0, mobile ? 3 : 5)) { const f = floater(r, x, y, z); cluster(0, 0, 0, CRYSTAL_COLORS[col], 5, r, f); }
    // crystals growing round the board's stone rim
    for (let k = 0; k < (mobile ? 10 : 16); k++) {
      const a = (k / (mobile ? 10 : 16)) * TAU + rand() * 0.2, d = rimR + 0.2;
      const col = ['amethyst', 'teal', 'amber'][k % 3];
      cluster(Math.cos(a) * d, -1.05, Math.sin(a) * d, CRYSTAL_COLORS[col], 3, 0.7);
    }
    // big clusters on the cave floor and walls, with lights near the brightest
    for (let k = 0; k < (mobile ? 10 : 18); k++) {
      const a = rand() * TAU, d = 12 + rand() * 30;
      const col = Object.keys(CRYSTAL_COLORS)[k % 5];
      cluster(Math.cos(a) * d, FLOOR, Math.sin(a) * d, CRYSTAL_COLORS[col], 7, 2.4 + rand() * 2);
      if (k < (mobile ? 2 : 4)) crystalLight(Math.cos(a) * d, FLOOR + 3, Math.sin(a) * d, CRYSTAL_COLORS[col], 80);
    }
    crystals.count = crystalN;
    crystals.instanceMatrix.needsUpdate = true;
    if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
    sapph.getWorldPosition(homePos); homePos.y += 1.2;
  }

  function update(t, dt) {
    for (const f of floaters) {
      const u = f.userData;
      f.position.y = u.y0 + Math.sin(t * 0.35 + u.phase) * 0.2;
      f.rotation.y += u.spin * dt;
      f.updateMatrixWorld(true);
    }
    for (const fl of followers) crystals.setMatrixAt(fl.i, m4.copy(fl.local).premultiply(fl.rock.matrixWorld));
    if (followers.length) crystals.instanceMatrix.needsUpdate = true;
    // crystals breathe a little; the lights flicker with them
    lights.forEach((l, k) => { l.intensity = (l.userData.base ??= l.intensity) * (0.85 + 0.15 * Math.sin(t * 1.3 + k * 2.1)); });
    shaft.material.opacity = 0.08 + 0.025 * Math.sin(t * 0.4);
    const p = dustGeo.attributes.position;
    for (let k = 0; k < DUST; k++) {
      let y = p.getY(k) - dt * 0.12;
      if (y < -1) y = 13;
      p.setY(k, y);
      p.setX(k, p.getX(k) + Math.sin(t * 0.4 + dSeed[k]) * dt * 0.08);
    }
    p.needsUpdate = true;
  }

  return { setBoardRadius, update, homePos };
}
