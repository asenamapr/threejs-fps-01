// Battlefield effects: tracers, impact sparks, muzzle smoke and the bomb's explosion.
// Everything is pooled and reused — no new objects in the hot loop — so a firefight
// never makes the garbage collector stutter.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 8;

export function createEffects(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.7 });
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(MAX_SPARKS * 3 * 10);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMat = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.12, transparent: true, opacity: 0.9 });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.visible = false;
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkState = { life: 0, velocities: [] };
  for (let i = 0; i < MAX_SPARKS * 10; i += 1) sparkState.velocities.push(new THREE.Vector3());

  const explosionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3d'), transparent: true, opacity: 0.85, depthWrite: false }),
  );
  explosionMesh.visible = false;
  scene.add(explosionMesh);
  const explosionLight = new THREE.PointLight(new THREE.Color('#ff9a3d'), 0, 30, 1.6);
  scene.add(explosionLight);
  const explosionState = { life: 0, maxRadius: 1 };

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mid = new THREE.Vector3();

  function tracer(start, end) {
    const slot = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
    from.copy(start);
    to.copy(end);
    mid.addVectors(from, to).multiplyScalar(0.5);
    slot.mesh.position.copy(mid);
    slot.mesh.lookAt(to);
    slot.mesh.scale.set(1, 1, from.distanceTo(to));
    slot.mesh.visible = true;
    slot.life = 0.07;
    slot.mesh.material.opacity = 0.7;
  }

  function impact(point) {
    for (let i = 0; i < 10; i += 1) {
      const index = i * 3;
      sparkPositions[index] = point.x;
      sparkPositions[index + 1] = point.y;
      sparkPositions[index + 2] = point.z;
      sparkState.velocities[i].set((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparks.visible = true;
    sparkState.life = 0.3;
  }

  function explosion(point, radius) {
    explosionMesh.position.copy(point);
    explosionMesh.scale.setScalar(0.5);
    explosionMesh.visible = true;
    explosionLight.position.copy(point);
    explosionLight.position.y += 1;
    explosionLight.intensity = 400;
    explosionState.life = 0.6;
    explosionState.maxRadius = radius;
  }

  function step(dt) {
    for (const slot of tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) slot.mesh.visible = false;
      else slot.mesh.material.opacity = Math.max(0, slot.life / 0.07) * 0.7;
    }
    if (sparkState.life > 0) {
      sparkState.life -= dt;
      for (let i = 0; i < 10; i += 1) {
        const index = i * 3;
        sparkPositions[index] += sparkState.velocities[i].x * dt;
        sparkPositions[index + 1] += sparkState.velocities[i].y * dt;
        sparkPositions[index + 2] += sparkState.velocities[i].z * dt;
        sparkState.velocities[i].y -= 9 * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      if (sparkState.life <= 0) sparks.visible = false;
    }
    if (explosionState.life > 0) {
      explosionState.life -= dt;
      const progress = 1 - explosionState.life / 0.6;
      explosionMesh.scale.setScalar(0.5 + progress * explosionState.maxRadius);
      explosionMesh.material.opacity = Math.max(0, 0.85 * (1 - progress));
      explosionLight.intensity = Math.max(0, 400 * (1 - progress));
      if (explosionState.life <= 0) {
        explosionMesh.visible = false;
        explosionLight.intensity = 0;
      }
    }
  }

  return { tracer, impact, explosion, step };
}

// A thrown grenade: a small sphere with a fuse, an arc under gravity, and a bounce off
// the map's colliders. The caller reads `done` and `kind` when the fuse runs out.
export function createGrenade(scene, start, direction, kind, random) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'flash' ? PALETTE.ink : PALETTE.rust), roughness: 0.5, metalness: 0.4 }),
  );
  mesh.position.copy(start);
  scene.add(mesh);
  const velocity = direction.clone().multiplyScalar(13);
  velocity.y += 4.5;
  const state = {
    kind,
    fuse: kind === 'flash' ? 1.4 : 2.6,
    done: false,
    position: mesh.position,
    velocity,
  };
  return {
    state,
    step(dt, colliders) {
      if (state.done) return;
      state.fuse -= dt;
      state.velocity.y -= 14 * dt;
      const next = state.position.clone().addScaledVector(state.velocity, dt);
      // Cheap bounce: test the next position against colliders, reflect the axis that hit.
      let hit = false;
      for (const collider of colliders) {
        if (collider.containsPoint(next)) { hit = true; break; }
      }
      if (hit) {
        state.velocity.multiplyScalar(-0.45);
        state.velocity.y = Math.abs(state.velocity.y) * 0.5 + 1;
      } else {
        state.position.copy(next);
      }
      if (state.position.y < 0.09) {
        state.position.y = 0.09;
        state.velocity.y = Math.abs(state.velocity.y) * 0.45;
        state.velocity.x *= 0.7;
        state.velocity.z *= 0.7;
      }
      if (state.fuse <= 0) {
        state.done = true;
        scene.remove(mesh);
      }
    },
    remove() { scene.remove(mesh); },
  };
}
