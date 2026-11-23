// Jelly physics for the blobs: meshless shape matching, after Müller, Heidelberger, Teschner &
// Gross, "Meshless Deformations Based on Shape Matching" (SIGGRAPH 2005).
//
// Each blob is a dozen particles. Every step we find the best rigid rotation R and the best
// linear deformation A that carry the rest shape onto where the particles are now, blend them
// (beta: how far the blob may squash and shear rather than stay rigid), scale A to keep the
// volume constant, and pull every particle towards its "goal" position under that transform with
// a spring (stiffness). Gravity, the floor, and pokes (landings, hops, nearby strikes) do the rest.
//
// The useful trick: linear shape matching yields exactly one 3x3 transform per blob, which is
// precisely what an instance matrix holds, so the rendered blob deforms with the simulation for
// free; a vertex shader adds fine ripples on top.
import * as THREE from 'three';

const GRAVITY = -3;
const H = 1 / 120;            // fixed sub-step

// 3x3 helpers on row-major arrays
const mul = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
function inv(m) {
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const k = 1 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * k, (m[2] * m[7] - m[1] * m[8]) * k, (m[1] * m[5] - m[2] * m[4]) * k,
    (m[5] * m[6] - m[3] * m[8]) * k, (m[0] * m[8] - m[2] * m[6]) * k, (m[2] * m[3] - m[0] * m[5]) * k,
    (m[3] * m[7] - m[4] * m[6]) * k, (m[1] * m[6] - m[0] * m[7]) * k, (m[0] * m[4] - m[1] * m[3]) * k,
  ];
}
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** The rotation part of A (polar decomposition), by averaging A with its inverse transpose. */
function rotationOf(a) {
  let r = a.slice();
  for (let k = 0; k < 10; k++) {
    const ri = inv(r);
    if (!ri) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const t = transpose(ri);
    for (let i = 0; i < 9; i++) r[i] = 0.5 * (r[i] + t[i]);
  }
  return r;
}

// the rest shape: an icosahedron's 12 corners, squashed like the blob mesh, centred on its middle
const REST = (() => {
  const g = new THREE.IcosahedronGeometry(0.3, 0), p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, new THREE.Vector3(p.getX(i), p.getY(i) * 0.72, p.getZ(i)));
  }
  return [...seen.values()];
})();
export const BLOB_CENTRE = 0.24; // height of the blob mesh's middle above its base

export class Jelly {
  constructor({ stiffness = 240, beta = 0.42 } = {}) {
    this.K = stiffness; this.beta = beta;
    this.q = REST.map((v) => v.clone());
    this.x = this.q.map((v) => v.clone());
    this.v = this.q.map(() => new THREE.Vector3());
    let aqq = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const q of this.q) { const a = [q.x, q.y, q.z]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) aqq[r * 3 + c] += a[r] * a[c]; }
    this.aqqInv = inv(aqq);
    this.T = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.c = new THREE.Vector3();
    this.acc = 0;
  }

  /** Put the blob (base) at a world position, at rest, optionally moving. */
  place(base, vel = null) {
    const c = new THREE.Vector3(base.x, base.y + BLOB_CENTRE, base.z);
    this.x.forEach((x, i) => { x.copy(this.q[i]).add(c); this.v[i].copy(vel || new THREE.Vector3()); });
    this.c.copy(c); this.T = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  /** Push every particle (a hop, a landing). */
  poke(vx, vy, vz) { for (const v of this.v) { v.x += vx; v.y += vy; v.z += vz; } }
  /** Shove a random side of the blob: an uneven wobble. */
  jolt(amount) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(amount);
    this.x.forEach((x, i) => { const w = Math.max(0, this.q[i].dot(d) / (0.3 * amount + 1e-6)); this.v[i].addScaledVector(d, 0.5 + w); });
  }

  /** Advance by dt seconds (fixed sub-steps), held near `home` (the cell's base position). */
  step(dt, home) {
    this.acc = Math.min(this.acc + dt, H * 8);
    while (this.acc >= H) { this.acc -= H; this.sub(home); }
  }

  sub(home) {
    const { x, v, q, K, beta } = this;
    // centre of mass
    const c = this.c.set(0, 0, 0);
    for (const p of x) c.add(p);
    c.multiplyScalar(1 / x.length);
    // best linear fit A of rest -> current, and its rotation R
    const apq = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      const p = [x[i].x - c.x, x[i].y - c.y, x[i].z - c.z], r = [q[i].x, q[i].y, q[i].z];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) apq[a * 3 + b] += p[a] * r[b];
    }
    const R = rotationOf(apq);
    let A = mul(apq, this.aqqInv);
    const d = det(A);
    if (d > 1e-6) { const s = 1 / Math.cbrt(d); A = A.map((e) => e * s); } else A = R; // keep the volume
    const T = this.T;
    for (let i = 0; i < 9; i++) T[i] = beta * A[i] + (1 - beta) * R[i];
    // a gentle pull back upright, so knocks don't leave a blob permanently leaning
    for (let i = 0; i < 9; i++) T[i] = T[i] * 0.97 + (i % 4 === 0 ? 0.03 : 0);
    // pull each particle toward its goal, plus gravity, a soft spring to its cell, and damping
    const hx = home.x - c.x, hy = home.y + BLOB_CENTRE - c.y, hz = home.z - c.z;
    for (let i = 0; i < x.length; i++) {
      const g0 = q[i];
      const gx = T[0] * g0.x + T[1] * g0.y + T[2] * g0.z + c.x;
      const gy = T[3] * g0.x + T[4] * g0.y + T[5] * g0.z + c.y;
      const gz = T[6] * g0.x + T[7] * g0.y + T[8] * g0.z + c.z;
      const vi = v[i];
      // goal spring (stiffness K): strong enough to hold the shape, soft enough to wobble ~2.5 times a second
      vi.x += (K * (gx - x[i].x) + hx * 40) * H;
      vi.y += (K * (gy - x[i].y) + GRAVITY + hy * 60) * H;
      vi.z += (K * (gz - x[i].z) + hz * 40) * H;
      vi.multiplyScalar(1 - 3.2 * H); // gentle damping: a few wobbles, then still
      x[i].addScaledVector(vi, H);
      // the floor: the cell's surface
      if (x[i].y < home.y) { x[i].y = home.y; if (vi.y < 0) vi.y *= -0.15; vi.x *= 0.85; vi.z *= 0.85; }
    }
  }

  /**
   * The instance matrix that draws the blob mesh (base at its origin, middle at BLOB_CENTRE)
   * deformed like the simulation, at overall scale s.
   */
  matrix(out, s = 1) {
    const T = this.T, c = this.c, k = BLOB_CENTRE * s;
    // world = c + T * s * (v - centre)  =>  linear part T*s, offset c - T*s*centre
    return out.set(
      T[0] * s, T[1] * s, T[2] * s, c.x - T[1] * k,
      T[3] * s, T[4] * s, T[5] * s, c.y - T[4] * k,
      T[6] * s, T[7] * s, T[8] * s, c.z - T[7] * k,
      0, 0, 0, 1,
    );
  }
}
