// Takeover effects: the ways a piece can be won over. scene.js picks one at random per capture.
//  - lightning: a forking bolt from the attacker to each victim (jagged by midpoint displacement,
//    re-forked a few times while it lives), with a flash of light.
//  - shockwave: a ring of light races out across the board; pieces turn as it passes.
//  - shatter: the old piece bursts into tumbling fragments.
//  - splash: blobs of goo arc from the attacker onto the victim.
//  - crystallise: crystal spikes erupt through a blob as it turns.
// Everything here is pooled and instanced; nothing is created per frame.
import * as THREE from 'three';

const TAU = Math.PI * 2;

export function createFx(scene, { mobile = false } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const glowMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const items = []; // live effects: { update(dt) -> keep? }

  // ---------------------------------------------------------- lightning
  const flash = new THREE.PointLight('#bfe0ff', 0, 9, 2);
  root.add(flash);
  let flashLeft = 0;
  function boltPoints(a, b, rough = 0.45) {
    let pts = [a.clone(), b.clone()];
    for (let level = 0; level < 5; level++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        const mid = p.clone().lerp(q, 0.5);
        const len = p.distanceTo(q);
        mid.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.3), (Math.random() - 0.5)).multiplyScalar(len * rough));
        next.push(mid, q);
      }
      pts = next;
    }
    return pts;
  }
  function tube(pts, r) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), pts.length * 2, r, 5, false); }
  /** A bolt from a to b (world positions). Lives ~0.35 s and re-forks while alive. */
  function lightning(a, b, color = '#cfe6ff') {
    const from = a.clone().setY(a.y + 0.55), to = b.clone().setY(b.y + 0.3);
    // arc upward between the two so it reads as a strike, not a wire
    const top = from.clone().lerp(to, 0.5); top.y += 0.6 + from.distanceTo(to) * 0.15;
    const make = () => {
      const pts = [...boltPoints(from, top, 0.5).slice(0, -1), ...boltPoints(top, to, 0.5)];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tube(pts, 0.06), glowMat(color)));
      g.add(new THREE.Mesh(tube(pts, 0.022), glowMat('#ffffff')));
      // a side fork
      if (!mobile || Math.random() < 0.5) {
        const k = 4 + ((Math.random() * (pts.length - 8)) | 0);
        const end = pts[k].clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.3 - Math.random() * 0.5, (Math.random() - 0.5) * 1.2));
        g.add(new THREE.Mesh(tube(boltPoints(pts[k], end, 0.4), 0.03), glowMat(color)));
      }
      return g;
    };
    let g = make(), life = 0, reforks = 0;
    root.add(g);
    flash.position.copy(to).setY(to.y + 0.6); flash.intensity = mobile ? 60 : 90; flashLeft = 0.3;
    items.push((dt) => {
      life += dt;
      if (life > 0.09 * (reforks + 1) && reforks < 4) { reforks++; dispose(g); g = make(); root.add(g); }
      const o = Math.max(0, 1 - life / 0.55);
      g.children.forEach((m) => { m.material.opacity = o * (0.7 + Math.random() * 0.3); });
      if (life >= 0.55) { dispose(g); return false; }
      return true;
    });
  }
  function dispose(g) { root.remove(g); g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }

  // ---------------------------------------------------------- shockwave
  const ringGeo = new THREE.RingGeometry(0.85, 1, 64); ringGeo.rotateX(-Math.PI / 2);
  /** A ring racing out from `at` to radius `maxR` at `speed` units/s. */
  function shockwave(at, maxR, speed, color) {
    const m = new THREE.Mesh(ringGeo, glowMat(color));
    m.position.copy(at).setY(0.04);
    root.add(m);
    let r = 0.1;
    items.push((dt) => {
      r += speed * dt;
      m.scale.set(r, 1, r);
      m.material.opacity = Math.max(0, 1 - r / maxR) * 0.9;
      if (r >= maxR) { root.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- shatter fragments (instanced)
  const FRAG = mobile ? 160 : 320;
  const fragMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.1), new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.15 }), FRAG);
  fragMesh.frustumCulled = false; fragMesh.count = 0;
  fragMesh.setColorAt(0, new THREE.Color());
  root.add(fragMesh);
  const frags = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  /** Burst a piece into fragments in the given colours. */
  function shatter(at, colors, count = 30) {
    for (let k = 0; k < count; k++) {
      if (frags.length >= FRAG) frags.shift();
      const a = Math.random() * TAU, sp = 1.2 + Math.random() * 2.2;
      frags.push({ p: at.clone().setY(at.y + 0.3 + Math.random() * 0.3), v: new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 2.5, Math.sin(a) * sp),
        r: new THREE.Vector3(Math.random() * TAU, Math.random() * TAU, 0), w: new THREE.Vector3(Math.random() * 14, Math.random() * 14, 0),
        s: 0.6 + Math.random() * 0.9, life: 0, max: 0.9 + Math.random() * 0.4, c: new THREE.Color(colors[k % colors.length]) });
    }
  }

  // ---------------------------------------------------------- goo splash (instanced droplets)
  const GOO = mobile ? 60 : 120;
  const gooMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshPhysicalMaterial({ color: '#4be36a', roughness: 0.05, clearcoat: 1, emissive: '#2bd15a', emissiveIntensity: 0.4 }), GOO);
  gooMesh.frustumCulled = false; gooMesh.count = 0;
  root.add(gooMesh);
  const goo = [];
  /** Lob droplets of goo from a to b, landing in `secs`; they splat flat on arrival. */
  function splash(a, b, secs = 0.35, count = 13) {
    for (let k = 0; k < count; k++) {
      if (goo.length >= GOO) goo.shift();
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35);
      goo.push({ a: a.clone().setY(0.35), b: b.clone().add(jitter).setY(0.06), t: -k * 0.02, dur: secs * (0.85 + Math.random() * 0.3), h: 0.7 + Math.random() * 0.5, s: 0.8 + Math.random() * 0.7, splat: 0 });
    }
  }

  // ---------------------------------------------------------- crystallise (spikes erupting)
  const spikeGeo = new THREE.ConeGeometry(0.08, 1, 6); spikeGeo.translate(0, 0.5, 0);
  const SPIKES = mobile ? 60 : 120;
  const spikeMesh = new THREE.InstancedMesh(spikeGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.95 }), SPIKES);
  spikeMesh.frustumCulled = false; spikeMesh.count = 0;
  spikeMesh.setColorAt(0, new THREE.Color());
  root.add(spikeMesh);
  const spikes = [];
  function crystallise(at, colors, count = 9) {
    for (let k = 0; k < count; k++) {
      if (spikes.length >= SPIKES) spikes.shift();
      spikes.push({ p: at.clone(), dir: new THREE.Euler((Math.random() - 0.5) * 1.6, Math.random() * TAU, (Math.random() - 0.5) * 1.6), len: 0.5 + Math.random() * 0.55, life: 0, max: 0.7, c: new THREE.Color(colors[k % colors.length]) });
    }
  }

  // ---------------------------------------------------------- beams (laser, prism)
  const Y = new THREE.Vector3(0, 1, 0);
  /** A straight beam of light from a to b: a coloured shaft with a white-hot core, flaring then fading. */
  function beam(a, b, color, dur = 0.35, r = 0.04) {
    const len = a.distanceTo(b), mid = a.clone().lerp(b, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize());
    const g = new THREE.Group(); g.position.copy(mid); g.quaternion.copy(q);
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10, 1, true), glowMat(color));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, len, 8, 1, true), glowMat('#ffffff'));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 3.2, 12, 8), glowMat(color)); tip.position.y = len / 2;
    g.add(outer, core, tip); root.add(g);
    let life = 0;
    items.push((dt) => {
      life += dt;
      const u = life / dur, flare = u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.85);
      g.scale.set(0.4 + flare * 1.1, 1, 0.4 + flare * 1.1);
      for (const m of g.children) m.material.opacity = flare;
      if (life >= dur) { dispose(g); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- meteor
  /** A glowing rock falls from `from` to `to` in `dur` seconds, trailing fire. */
  function meteor(from, to, dur, color) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: '#fff4dd', toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), glowMat(color));
    const trailGeo = new THREE.ConeGeometry(0.22, 1.8, 10, 1, true); trailGeo.translate(0, 0.9, 0);
    const trail = new THREE.Mesh(trailGeo, glowMat(color));
    g.add(rock, halo, trail); root.add(g);
    const dir = to.clone().sub(from).normalize();
    trail.quaternion.setFromUnitVectors(Y, dir.clone().negate());
    let life = 0;
    items.push((dt) => {
      life += dt;
      const u = Math.min(1, life / dur), e = u * u; // accelerating
      g.position.lerpVectors(from, to, e);
      rock.rotation.x += dt * 9; rock.rotation.y += dt * 7;
      trail.scale.set(1, 0.4 + e * 1.2, 1);
      halo.material.opacity = 0.6 + Math.random() * 0.4;
      if (u >= 1) { dispose(g); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- tentacle
  /** A jelly tentacle reaches from a to b along a wobbly arc, growing over `dur`, then withdraws. */
  function tentacle(a, b, color, dur = 0.3) {
    const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar((Math.random() - 0.5) * 1.2);
    const p0 = a.clone().setY(0.3), p3 = b.clone().setY(0.35);
    const p1 = a.clone().lerp(b, 0.33).add(side).setY(1.1), p2 = a.clone().lerp(b, 0.7).sub(side.clone().multiplyScalar(0.6)).setY(0.9);
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2, p3]), 48, 0.075, 10, false);
    // taper toward the tip
    const pos = geo.attributes.position, seg = 49, ring = 11;
    const path = new THREE.CatmullRomCurve3([p0, p1, p2, p3]), c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let s = 0; s < seg; s++) {
      path.getPointAt(s / (seg - 1), c);
      const k = 1 - (s / (seg - 1)) * 0.65;
      for (let r = 0; r < ring; r++) { const i = s * ring + r; v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(k).add(c); pos.setXYZ(i, v.x, v.y, v.z); }
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, clearcoat: 1, emissive: color, emissiveIntensity: 0.35, transparent: true }));
    root.add(m);
    const total = geo.index.count;
    let life = 0;
    items.push((dt) => {
      life += dt;
      const grow = Math.min(1, life / dur);
      geo.setDrawRange(0, Math.floor(total * grow));
      if (life > dur + 0.18) m.material.opacity = Math.max(0, 1 - (life - dur - 0.18) / 0.2);
      if (life > dur + 0.4) { root.remove(m); geo.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- ice block
  /** A faceted block of ice freezes around a piece (it's shattered by the caller). */
  function iceBlock(at, dur = 0.45) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52, 0), new THREE.MeshPhysicalMaterial({
      color: '#d9f3ff', roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.62, emissive: '#7fd3ff', emissiveIntensity: 0.35, flatShading: true }));
    m.position.copy(at).setY(0.42); m.scale.set(0.01, 0.01, 0.01); m.rotation.y = Math.random() * TAU;
    root.add(m);
    let life = 0;
    items.push((dt) => {
      life += dt;
      const s = Math.min(1, life / 0.16);
      m.scale.set(s * 1.05, s * 1.25, s * 1.05);
      if (life >= dur) { root.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- vortex
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  /** A spiral of light swirls up around a piece and draws in. */
  function vortex(at, color, dur = 0.55) {
    const N = mobile ? 28 : 48;
    const geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, map: dotTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pts.frustumCulled = false; root.add(pts);
    const seeds = Array.from({ length: N }, (_, k) => ({ a: (k / N) * TAU * 3, r: 0.6 + Math.random() * 0.35, h: Math.random() * 0.2 }));
    let life = 0;
    items.push((dt) => {
      life += dt;
      const u = Math.min(1, life / dur);
      seeds.forEach((s, k) => {
        const ang = s.a + u * 14 + u * u * 10, r = s.r * (1 - u * 0.85), y = 0.1 + s.h + u * 1.3 * (0.5 + (k % 5) / 5);
        p[k * 3] = at.x + Math.cos(ang) * r; p[k * 3 + 1] = y; p[k * 3 + 2] = at.z + Math.sin(ang) * r;
      });
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2;
      if (u >= 1) { root.remove(pts); geo.dispose(); pts.material.dispose(); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------- firework rocket
  /** A rocket climbs from a piece, trailing sparks, to burst overhead (the caller adds the burst). */
  function rocket(at, color, dur = 0.45) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })));
    const tail = new THREE.Mesh((() => { const t = new THREE.ConeGeometry(0.07, 0.8, 8, 1, true); t.translate(0, -0.4, 0); return t; })(), glowMat(color));
    g.add(tail); root.add(g);
    let life = 0;
    const sway = (Math.random() - 0.5) * 0.6;
    items.push((dt) => {
      life += dt;
      const u = Math.min(1, life / dur), e = 1 - (1 - u) * (1 - u);
      g.position.set(at.x + sway * u, 0.4 + e * 2.4, at.z);
      tail.scale.set(1, 0.4 + (1 - u) * 1.2, 1);
      if (u >= 1) { dispose(g); return false; }
      return true;
    });
  }

  function update(dt) {
    for (let i = items.length - 1; i >= 0; i--) if (!items[i](dt)) items.splice(i, 1);
    if (flashLeft > 0) { flashLeft -= dt; if (flashLeft <= 0) flash.intensity = 0; else flash.intensity *= 0.82; }
    // fragments: fall, bounce on the board, fade by shrinking
    let n = 0;
    for (let i = frags.length - 1; i >= 0; i--) {
      const f = frags[i];
      f.life += dt;
      if (f.life > f.max) { frags.splice(i, 1); continue; }
      f.v.y -= 9 * dt; f.p.addScaledVector(f.v, dt);
      if (f.p.y < 0.03) { f.p.y = 0.03; f.v.y *= -0.35; f.v.x *= 0.7; f.v.z *= 0.7; }
      f.r.addScaledVector(f.w, dt);
      const s = f.s * Math.min(1, (f.max - f.life) * 4);
      M.compose(f.p, Q.setFromEuler(E.set(f.r.x, f.r.y, 0)), S.set(s, s, s));
      fragMesh.setMatrixAt(n, M); fragMesh.setColorAt(n, f.c); n++;
    }
    fragMesh.count = n; fragMesh.instanceMatrix.needsUpdate = true; if (fragMesh.instanceColor) fragMesh.instanceColor.needsUpdate = true;
    // goo: arc, then splat flat and soak away
    n = 0;
    for (let i = goo.length - 1; i >= 0; i--) {
      const g = goo[i];
      g.t += dt;
      if (g.t < 0) continue;
      const u = Math.min(1, g.t / g.dur);
      let x, y, z, sx = g.s, sy = g.s;
      if (u < 1) { x = g.a.x + (g.b.x - g.a.x) * u; z = g.a.z + (g.b.z - g.a.z) * u; y = g.a.y + (g.b.y - g.a.y) * u + Math.sin(u * Math.PI) * g.h; sy = g.s * 1.3; sx = g.s * 0.85; }
      else { g.splat += dt; x = g.b.x; y = g.b.y; z = g.b.z; sx = g.s * (1 + g.splat * 6); sy = g.s * Math.max(0.05, 0.4 - g.splat * 1.2); if (g.splat > 0.4) { goo.splice(i, 1); continue; } }
      M.compose(S.set(x, y, z), Q.identity(), new THREE.Vector3(sx, sy, sx));
      gooMesh.setMatrixAt(n++, M);
    }
    gooMesh.count = n; gooMesh.instanceMatrix.needsUpdate = true;
    // spikes: shoot out fast, hold, then retract
    n = 0;
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i];
      s.life += dt;
      if (s.life > s.max) { spikes.splice(i, 1); continue; }
      const u = s.life / s.max, grow = u < 0.25 ? u / 0.25 : u > 0.7 ? Math.max(0, 1 - (u - 0.7) / 0.3) : 1;
      M.compose(s.p, Q.setFromEuler(s.dir), S.set(1 + grow, s.len * grow + 0.001, 1 + grow));
      spikeMesh.setMatrixAt(n, M); spikeMesh.setColorAt(n, s.c); n++;
    }
    spikeMesh.count = n; spikeMesh.instanceMatrix.needsUpdate = true; if (spikeMesh.instanceColor) spikeMesh.instanceColor.needsUpdate = true;
  }

  return { lightning, shockwave, shatter, splash, crystallise, beam, meteor, tentacle, iceBlock, vortex, rocket, update };
}
