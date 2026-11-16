// The spark charge: the objective beyond killing. Vanguard plants it at Site A or Site B
// by holding E inside the ring; the fuse runs 40 seconds while Sentinel converges to
// defuse it (5 seconds holding E at the ring). Plant wins the round for Vanguard if the
// fuse runs out; defuse wins it for Sentinel. A planted charge beeps faster as the fuse
// runs down, and its ring pulses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const FUSE_TIME = 40;

export function createBomb(scene, sites) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.22, 0.34),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.5, metalness: 0.4 }),
  );
  const lightMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30') }),
  );
  lightMesh.position.set(0.18, 0.13, 0);
  group.add(body, lightMesh);
  group.visible = false;
  scene.add(group);

  const state = {
    status: 'carried', // carried | planting | planted | defusing | exploded | defused | dropped
    site: null,
    progress: 0,
    fuse: FUSE_TIME,
    beepTimer: 0,
    dropPos: null,
  };

  function siteOf(position) {
    for (const [key, site] of Object.entries(sites)) {
      const dx = position.x - site.x;
      const dz = position.z - site.z;
      if (dx * dx + dz * dz <= site.radius * site.radius) return key;
    }
    return null;
  }

  return {
    state,
    siteOf,
    // The carrier went down: the charge lies where they fell until someone walks over it.
    drop(position) {
      state.status = 'dropped';
      state.progress = 0;
      state.dropPos = position.clone();
      state.dropPos.y = 0.12;
      group.position.copy(state.dropPos);
      group.visible = true;
    },
    pickup() {
      state.status = 'carried';
      state.progress = 0;
      state.dropPos = null;
      group.visible = false;
    },
    // Called every fixed step with whether the planter is holding E inside a site.
    // Returns 'planted' on the step the plant completes, 'defused' when a defuse
    // completes, 'exploded' when the fuse runs out, else null.
    step(dt, planterHolding, planterPosition, defuserHolding, defuserPosition) {
      if (state.status === 'dropped') return null;
      if (state.status === 'carried' || state.status === 'planting') {
        if (planterHolding) {
          const site = siteOf(planterPosition);
          if (site) {
            state.status = 'planting';
            state.site = site;
            state.progress += dt / PLANT_TIME;
            if (state.progress >= 1) {
              state.status = 'planted';
              state.progress = 0;
              state.fuse = FUSE_TIME;
              const sitePos = sites[site];
              group.position.set(sitePos.x, 0.12, sitePos.z);
              group.visible = true;
              return 'planted';
            }
          } else {
            state.status = 'carried';
            state.progress = 0;
          }
        } else {
          state.status = 'carried';
          state.progress = 0;
        }
        return null;
      }
      if (state.status === 'planted' || state.status === 'defusing') {
        state.fuse -= dt;
        state.beepTimer -= dt;
        const interval = state.fuse > 20 ? 1.0 : state.fuse > 10 ? 0.55 : 0.28;
        if (state.beepTimer <= 0) {
          state.beepTimer = interval;
          lightMesh.visible = !lightMesh.visible;
        }
        if (defuserHolding && defuserPosition) {
          const site = sites[state.site];
          const dx = defuserPosition.x - site.x;
          const dz = defuserPosition.z - site.z;
          if (dx * dx + dz * dz <= site.radius * site.radius) {
            state.status = 'defusing';
            state.progress += dt / DEFUSE_TIME;
            if (state.progress >= 1) {
              state.status = 'defused';
              group.visible = false;
              return 'defused';
            }
          } else {
            state.status = 'planted';
            state.progress = 0;
          }
        } else {
          state.status = 'planted';
          state.progress = 0;
        }
        if (state.fuse <= 0) {
          state.status = 'exploded';
          group.visible = false;
          return 'exploded';
        }
        return null;
      }
      return null;
    },
    reset() {
      state.status = 'carried';
      state.site = null;
      state.progress = 0;
      state.fuse = FUSE_TIME;
      state.beepTimer = 0;
      state.dropPos = null;
      group.visible = false;
    },
  };
}
