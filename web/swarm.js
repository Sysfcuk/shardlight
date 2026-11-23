// A living swarm: glowing cave wisps drifting around the board using boids (Reynolds' flocking rules:
// keep apart, match your neighbours' heading, drift towards the group), plus a leader point they
// all chase. The leader loops between the board and the straw hive; swoop() sends the whole
// swarm sweeping over a spot (a big capture), and celebrate() sets it circling the winners.
import * as THREE from 'three';

export function createSwarm(scene, { count, bodyGeo, wingGeo = null, bodyMat, wingMat, home, scale = 0.34, maxSpeed = 3.6, lift = 0.42, colors = null }) {
  const body = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const wings = wingGeo ? new THREE.InstancedMesh(wingGeo, wingMat, count * 2) : null;
  body.frustumCulled = false;
  if (wings) wings.frustumCulled = false;
  if (colors) for (let k = 0; k < count; k++) body.setColorAt(k, new THREE.Color(colors[k % colors.length]));
  // no shadows: a flock of little spots drifting over the cells looks like stains
  scene.add(body); if (wings) scene.add(wings);

  const pos = [], vel = [];
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 3;
    pos.push(new THREE.Vector3(Math.cos(a) * r, 2 + Math.random() * 2, Math.sin(a) * r));
    vel.push(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(2));
  }
  const leader = new THREE.Vector3();
  let radius = 6, swoopAt = -9, swoopPos = new THREE.Vector3(), cheerUntil = -9, cheerPos = new THREE.Vector3();
  const tmp = new THREE.Vector3(), sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3();
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), SC = new THREE.Vector3();
  const SCALE = scale, MAX_SPEED = maxSpeed;

  function update(dt, t) {
    // the leader: a lazy figure-of-eight around the board that visits the hive now and then
    if (t < swoopAt + 1.4) leader.copy(swoopPos).setY(1.2 + (t - swoopAt) * 0.8);
    else if (t < cheerUntil) leader.set(cheerPos.x + Math.cos(t * 2.2) * 2, 2.2 + Math.sin(t * 3) * 0.4, cheerPos.z + Math.sin(t * 2.2) * 2);
    else {
      const a = t * 0.16, visit = Math.max(0, Math.sin(t * 0.05)) ** 6; // occasionally drift home
      // a loop around the board's edge, never across it, so the pieces stay clear
      const rr = radius + 1.2 + Math.sin(t * 0.23) * 0.8;
      leader.set(Math.cos(a) * rr, 2.4 + Math.sin(t * 0.7) * 0.7, Math.sin(a) * rr);
      if (home) leader.lerp(tmp.copy(home).add(P.set(0, 0.8, 0)), visit);
    }
    for (let i = 0; i < count; i++) {
      const p = pos[i], v = vel[i];
      sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
      let n = 0;
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const d2 = p.distanceToSquared(pos[j]);
        if (d2 > 2.2) continue;
        n++;
        ali.add(vel[j]); coh.add(pos[j]);
        if (d2 < 0.35) sep.add(tmp.subVectors(p, pos[j]).divideScalar(d2 + 0.01));
      }
      const acc = tmp.set(0, 0, 0);
      if (n) {
        acc.addScaledVector(ali.divideScalar(n).sub(v), 0.6);
        acc.addScaledVector(coh.divideScalar(n).sub(p), 0.5);
      }
      acc.addScaledVector(sep, 0.9);
      // chase the leader, each bee a little differently
      acc.addScaledVector(P.subVectors(leader, p), 0.55 + (i % 5) * 0.08);
      // stay above the board and below the clouds
      if (p.y < 1.0) acc.y += (1.0 - p.y) * 6;
      // keep off the playing area unless swooping or cheering: push outwards (or upwards) over the board
      const hr = Math.hypot(p.x, p.z);
      if (t > swoopAt + 1.4 && t > cheerUntil && hr < radius - 0.3) { const k = (radius - 0.3 - hr) * 3; acc.x += (p.x / (hr + 0.01)) * k; acc.z += (p.z / (hr + 0.01)) * k; acc.y += k * 0.6; }
      if (p.y > 6) acc.y -= (p.y - 6) * 3;
      // a little wander
      acc.x += Math.sin(t * 1.3 + i * 1.7) * 0.8; acc.z += Math.cos(t * 1.1 + i * 2.3) * 0.8; acc.y += Math.sin(t * 2 + i) * 0.4;
      v.addScaledVector(acc, dt);
      const s = v.length(), max = t < swoopAt + 1.4 ? MAX_SPEED * 1.8 : MAX_SPEED;
      if (s > max) v.multiplyScalar(max / s);
      p.addScaledVector(v, dt);
      // face the way it's flying, banking into turns
      const yaw = Math.atan2(-v.z, v.x), pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) * 0.6;
      E.set(0, yaw, pitch, 'YZX'); Q.setFromEuler(E);
      // wisps pulse gently in size
      const sc = SCALE * (colors ? 0.8 + 0.35 * Math.sin(t * 3 + i * 1.9) : 1);
      M.compose(P.copy(p).setY(p.y - lift * SCALE), Q, SC.set(sc, sc, sc));
      body.setMatrixAt(i, M);
      if (!wings) continue;
      const flap = 0.5 + 0.5 * Math.sin(t * 60 + i * 3);
      for (let w = 0; w < 2; w++) {
        const side = w ? -1 : 1;
        E.set(side * (0.4 + flap * 1.1), 0, 0.45, 'ZXY'); Q.setFromEuler(E);
        M2.compose(P.set(-0.04, 0.7, 0.07 * side), Q, SC.set(1, 1, 1)).premultiply(M);
        wings.setMatrixAt(i * 2 + w, M2);
      }
    }
    body.instanceMatrix.needsUpdate = true;
    if (wings) wings.instanceMatrix.needsUpdate = true;
  }

  return {
    update,
    setRadius(r) { radius = r; },
    /** Send the swarm sweeping over a world position. */
    swoop(p, t) { swoopPos.copy(p); swoopAt = t; },
    /** Circle over a spot for a while (the winners). */
    celebrate(p, t, secs = 6) { cheerPos.copy(p); cheerUntil = t + secs; },
  };
}
