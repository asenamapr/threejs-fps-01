// The arsenal. Four guns and two throwables, each with its own numbers: damage, headshot
// multiplier, magazine, fire rate, reload, spread and price. The numbers are the tactics:
// the rifle wins duels, the SMG wins up close, the shotgun wins a corner, the pistol is
// free and always there. Spread is the gunplay rule: it grows with movement speed and with
// every shot in a burst, and crouching or standing still shrinks it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 34, headMult: 4,
    mag: 12, reserve: 36, auto: false, gap: 0.16, reload: 1.4,
    spreadStill: 0.003, spreadMove: 0.02, kick: 0.011, range: 60,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Carbine', price: 2700, damage: 33, headMult: 4,
    mag: 30, reserve: 90, auto: true, gap: 0.1, reload: 2.1,
    spreadStill: 0.0022, spreadMove: 0.03, kick: 0.016, range: 90,
  },
  smg: {
    id: 'smg', name: 'Kestrel-9', price: 1500, damage: 26, headMult: 4,
    mag: 32, reserve: 96, auto: true, gap: 0.075, reload: 1.8,
    spreadStill: 0.004, spreadMove: 0.024, kick: 0.01, range: 45,
  },
  shotgun: {
    id: 'shotgun', name: 'Mule-12', price: 1700, damage: 9, headMult: 2,
    mag: 6, reserve: 18, auto: false, gap: 0.85, reload: 2.6,
    spreadStill: 0.03, spreadMove: 0.045, kick: 0.05, range: 22, pellets: 8,
  },
};

export const THROWABLES = {
  frag: { id: 'frag', name: 'Frag-7', price: 300, fuse: 2.6, radius: 7, damage: 130 },
  flash: { id: 'flash', name: 'Lumen Flash', price: 200, fuse: 1.4, radius: 16 },
};

// A view model built from boxes, one per weapon shape, held at the bottom-right of the
// camera. It kicks back and tilts on reload; the muzzle flash is a plane + point light.
export function createViewModel(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  const models = {};
  function build(parts, pos) {
    const group = new THREE.Group();
    for (const [w, h, d, x, y, z, mat] of parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat === 'dark' ? dark : mat === 'grip' ? grip : body);
      mesh.position.set(x, y, z);
      group.add(mesh);
    }
    group.position.set(pos[0], pos[1], pos[2]);
    group.scale.setScalar(0.8);
    group.userData.baseZ = pos[2];
    group.visible = false;
    camera.add(group);
    return group;
  }
  models.pistol = build([
    [0.07, 0.09, 0.2, 0, 0, -0.05, 'body'],
    [0.06, 0.14, 0.07, 0, -0.09, 0.06, 'grip'],
  ], [0.24, -0.23, -0.52]);
  models.rifle = build([
    [0.09, 0.1, 0.42, 0, 0, 0, 'body'],
    [0.045, 0.045, 0.42, 0, 0.03, -0.4, 'grip'],
    [0.075, 0.08, 0.22, 0, -0.02, 0.3, 'grip'],
    [0.03, 0.06, 0.1, 0, 0.07, -0.1, 'dark'],
  ], [0.26, -0.24, -0.55]);
  models.smg = build([
    [0.08, 0.09, 0.3, 0, 0, 0, 'body'],
    [0.04, 0.04, 0.3, 0, 0.025, -0.28, 'grip'],
    [0.05, 0.16, 0.05, 0, -0.1, 0.08, 'grip'],
    [0.06, 0.06, 0.12, 0, -0.03, 0.18, 'dark'],
  ], [0.26, -0.24, -0.53]);
  models.shotgun = build([
    [0.1, 0.1, 0.5, 0, 0, 0, 'body'],
    [0.07, 0.07, 0.3, 0, -0.04, -0.2, 'grip'],
    [0.08, 0.08, 0.2, 0, -0.02, 0.28, 'grip'],
  ], [0.26, -0.25, -0.56]);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.21, -1.1);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.2, -0.75);
  camera.add(flashLight);

  const state = { flash: 0, kick: 0, reloadLeft: 0, reloadTime: 1 };
  return {
    state,
    show(id) {
      for (const key of Object.keys(models)) models[key].visible = key === id;
    },
    fire() {
      state.flash = 0.06;
      state.kick = 0.06;
    },
    startReload(time) {
      state.reloadLeft = time;
      state.reloadTime = time;
    },
    step(dt, currentId) {
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      const model = models[currentId];
      if (model) {
        model.position.z = model.userData.baseZ + state.kick;
        model.rotation.x = state.kick * 2.4;
        if (state.reloadLeft > 0) {
          state.reloadLeft = Math.max(0, state.reloadLeft - dt);
          model.rotation.x = -0.5 * Math.min(1, (state.reloadTime - state.reloadLeft) * 2);
        }
      }
      flash.visible = state.flash > 0;
      if (state.flash > 0) flash.rotation.z = state.flash * 40;
      flashLight.intensity = state.flash > 0 ? 20 : 0;
    },
  };
}

// One weapon's live state: magazine, reserve, cooldown, reload timer, heat (the burst
// penalty). The caller owns the ray; this owns the numbers.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    heat: 0,
  };
}

export function weaponStep(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.heat = Math.max(0, state.heat - dt * 2.2);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

export function weaponFire(state) {
  if (!weaponReady(state)) return false;
  state.mag -= 1;
  state.cooldown = state.def.gap;
  state.heat = Math.min(1, state.heat + (state.def.auto ? 0.16 : 0.3));
  return true;
}

export function weaponReload(state) {
  if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
  state.reloadLeft = state.def.reload;
  return true;
}

// Spread in radians: still + moving + burst heat, cut by crouching. Firing on the move
// at full sprint is roughly ten times less accurate than standing still.
export function weaponSpread(state, speed, crouching) {
  const def = state.def;
  const move = Math.min(1, speed / 5.4);
  let spread = def.spreadStill + move * def.spreadMove + state.heat * def.spreadStill * 6;
  if (crouching) spread *= 0.7;
  return spread;
}
