// The two sides, built in code, with deliberately opposite silhouettes:
//  - Rubies: a jagged crystal cluster: one tall spire with smaller shards bursting out at angles,
//    on a rough chip of rock. Hard, sharp and flat-faceted.
//  - Sapphires: a living blob of molten sapphire: a glossy droplet that never stops wobbling
//    (a vertex shader ripples and breathes it, each blob on its own rhythm).
// Pieces stand on y = 0 and are about 0.7 units across.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const rand = (() => { let s = 424242; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

function prep(g) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  return g;
}

/** One crystal shard: a six-sided prism with a pyramid tip, base at the origin, pointing up. */
function shard(h, r) {
  const body = new THREE.CylinderGeometry(r * 0.82, r, h * 0.72, 6, 1);
  body.translate(0, h * 0.36, 0);
  const tip = new THREE.ConeGeometry(r * 0.82, h * 0.28, 6, 1);
  tip.translate(0, h * 0.72 + h * 0.14, 0);
  // a little irregularity so no two faces catch the light the same
  for (const g of [body, tip]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.01) { p.setX(i, p.getX(i) * (0.9 + rand() * 0.2)); p.setZ(i, p.getZ(i) * (0.9 + rand() * 0.2)); }
  }
  return [prep(body), prep(tip)];
}

/** Each shard in a cluster is a different gemstone: ruby, amber, emerald, amethyst, sapphire, rose, topaz. */
export const SHARD_COLORS = ['#ff2d55', '#ffb02e', '#35e08a', '#b45cff', '#3d8bff', '#ff6ec7', '#ffe14a'];

function paint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** The shard cluster: every crystal in it a different colour. */
export function crystalClusterGeometry() {
  const parts = [];
  let k = 0;
  const place = (h, r, tilt, yaw, x, z) => {
    const color = SHARD_COLORS[k++ % SHARD_COLORS.length];
    for (const g of shard(h, r)) {
      g.rotateZ(tilt); g.rotateY(yaw); g.translate(x, 0.06, z);
      parts.push(paint(g, color));
    }
  };
  place(0.78, 0.15, 0.05, 0.3, 0, 0);                    // the tall central spire
  place(0.58, 0.12, 0.5, 0.2, 0.06, 0.0);                 // shards bursting outwards
  place(0.52, 0.11, 0.55, 2.3, -0.03, 0.06);
  place(0.48, 0.105, 0.6, 4.2, -0.03, -0.05);
  place(0.36, 0.085, 0.78, 1.2, 0.02, 0.08);
  place(0.32, 0.08, 0.82, 3.3, -0.06, -0.01);
  place(0.3, 0.075, 0.88, 5.3, 0.05, -0.07);
  // a rough chip of dark rock it grows from
  const chip = prep(new THREE.DodecahedronGeometry(0.2, 0));
  chip.scale(1.25, 0.45, 1.15); chip.translate(0, 0.05, 0);
  parts.push(paint(chip, '#3a3550'));
  const g = mergeGeometries(parts);
  // chunkier than the raw shards, so a cluster carries the same weight on the board as a blob
  g.scale(1.35, 1.05, 1.35);
  g.computeVertexNormals(); // non-indexed, so every facet keeps its own flat normal
  g.computeBoundingSphere();
  return g;
}

/** The sapphire blob: a soft droplet with a little peak on top and a flattened base. */
export function blobGeometry() {
  // merge the icosphere's per-face vertices so the blob shades smooth, not faceted
  const ico = new THREE.IcosahedronGeometry(0.33, 6);
  ico.deleteAttribute('uv'); ico.deleteAttribute('normal');
  const g = mergeVertices(ico);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ny = v.y / 0.33;
    v.y *= 0.82;
    if (ny < -0.35) v.y = -0.33 * 0.82 * 0.35 + (v.y + 0.33 * 0.82 * 0.35) * 0.35; // settle onto the floor
    v.y += 0.09 * Math.pow(Math.max(0, ny), 6);                               // a soft peak
    const bulge = 1 + 0.12 * Math.max(0, -ny);                                 // wider at the bottom, like a drop at rest
    v.x *= bulge; v.z *= bulge;
    p.setXYZ(i, v.x, v.y + 0.18, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A small glowing orb for the cave wisps. */
export function wispGeometry() { return new THREE.IcosahedronGeometry(0.3, 1); }

/**
 * Crystal material. Desktop: real refraction (transmission) with a little dispersion for fire.
 * Phones: no transmission pass; a glossy, softly glowing stone that reads the same at a glance.
 */
export function crystalMaterial({ rich = true } = {}) {
  // colour comes from each shard's vertex colours; the glow is tinted by them too
  const m = new THREE.MeshPhysicalMaterial(rich
    ? { color: '#ffffff', vertexColors: true, roughness: 0.04, metalness: 0, transmission: 0.55, thickness: 0.6, ior: 1.77, dispersion: 0.45,
        specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.03, emissive: '#ffffff', emissiveIntensity: 0.3, flatShading: true, envMapIntensity: 1.7 }
    : { color: '#ffffff', vertexColors: true, roughness: 0.08, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.32,
        flatShading: true, envMapIntensity: 1.8 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
  };
  m.customProgramCacheKey = () => 'shard-crystal' + (rich ? '-rich' : '');
  return m;
}

/**
 * Blob material: glossy liquid with an oily, thin-film sheen, that wobbles. The vertex shader
 * ripples the surface along its normals and makes it breathe (taller and thinner, then squatter),
 * seeding the rhythm from each instance's position so no two blobs move in step.
 * Call material.userData.tick(seconds) every frame.
 */
export function blobMaterial(color, { rich = true } = {}) {
  const c = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial(rich
    ? { color: c, roughness: 0.06, metalness: 0, transmission: 0.55, thickness: 0.9, ior: 1.38, attenuationColor: c, attenuationDistance: 0.45,
        clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.5, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 600],
        emissive: c, emissiveIntensity: 0.22, envMapIntensity: 1.6 }
    : { color: c, roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.4, emissive: c, emissiveIntensity: 0.36, envMapIntensity: 1.8 });
  const uniforms = { uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float seed = 0.0;
        #ifdef USE_INSTANCING
          seed = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
        #endif
        float t = uTime;
        // the big squash and stretch comes from the jelly simulation (jelly.js) through the
        // instance matrix; this adds only the fine surface ripple on top
        float ripple = sin(position.x * 11.0 + t * 2.6 + seed) * sin(position.y * 9.0 + t * 1.9) * sin(position.z * 10.0 + t * 3.1 + seed * 0.7);
        transformed += normalize(objectNormal) * ripple * 0.022 * smoothstep(0.03, 0.12, position.y);`);
  };
  m.customProgramCacheKey = () => 'jelly-blob' + (rich ? '-rich' : '');
  m.userData.tick = (t) => { uniforms.uTime.value = t; };
  return m;
}
