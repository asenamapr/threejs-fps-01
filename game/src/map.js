// Cinder Yard: an original rail yard, 56 x 44 m, built from boxes. Vanguard (the
// player's team) spawns south and pushes north up three lanes — West Track to Site A,
// the rail line through Mid, East Track to Site B — while Sentinel holds the two sites.
// Every box is a collider for players and bots and a surface a bullet stops on. No part
// of this map copies any commercial game: the names, the layout and the palette are new.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { x: -20, z: -14, radius: 4.2 },
  B: { x: 20, z: -14, radius: 4.2 },
};
export const SPAWNS = {
  vanguard: [
    { x: -4, z: 19, yaw: 0 }, { x: 0, z: 19.5, yaw: 0 }, { x: 4, z: 19, yaw: 0 },
    { x: -8, z: 18, yaw: 0.3 }, { x: 8, z: 18, yaw: -0.3 },
  ],
  sentinel: [
    { x: -4, z: -19, yaw: Math.PI }, { x: 0, z: -19.5, yaw: Math.PI }, { x: 4, z: -19, yaw: Math.PI },
    { x: -8, z: -18, yaw: Math.PI - 0.3 }, { x: 8, z: -18, yaw: Math.PI + 0.3 },
  ],
};

// Waypoints the bots walk: a graph over the yard. Each entry lists its neighbours, so a
// bot finds a route with a plain breadth-first search and never walks through a wall.
export const WAYPOINTS = [
  { x: 0, z: 19, links: [1, 2, 3] },       // 0 attacker spawn
  { x: -10, z: 15, links: [0, 4, 7] },    // 1 west approach
  { x: 10, z: 15, links: [0, 5, 8] },     // 2 east approach
  { x: 0, z: 13, links: [0, 7, 8, 9] },   // 3 mid mouth
  { x: -19, z: 9, links: [1, 6, 10] },    // 4 west track
  { x: 19, z: 9, links: [2, 6, 11] },     // 5 east track
  { x: 0, z: 9, links: [4, 5, 9] },       // 6 cross yard
  { x: -13, z: 4, links: [1, 3, 10, 12] },// 7 west mid
  { x: 13, z: 4, links: [2, 3, 11, 13] }, // 8 east mid
  { x: 0, z: 3, links: [3, 6, 7, 8, 14] },// 9 mid gantry
  { x: -21, z: -1, links: [4, 7, 15] },   // 10 A lane
  { x: 21, z: -1, links: [5, 8, 16] },    // 11 B lane
  { x: -11, z: -4, links: [7, 14, 17] },  // 12 west connector
  { x: 11, z: -4, links: [8, 14, 18] },   // 13 east connector
  { x: 0, z: -6, links: [9, 12, 13, 19] },// 14 mid north
  { x: -20, z: -9, links: [10, 17, 20] }, // 15 A approach
  { x: 20, z: -9, links: [11, 18, 21] },  // 16 B approach
  { x: -15, z: -10, links: [12, 15, 22] },// 17 A hold
  { x: 15, z: -10, links: [13, 16, 23] }, // 18 B hold
  { x: 0, z: -12, links: [14, 17, 18, 24] }, // 19 north cross
  { x: -20, z: -14, links: [15, 22] },    // 20 site A
  { x: 20, z: -14, links: [16, 23] },     // 21 site B
  { x: -24, z: -17, links: [17, 20, 24] },// 22 A corner
  { x: 24, z: -17, links: [18, 21, 24] }, // 23 B corner
  { x: 0, z: -19, links: [19, 22, 23] },  // 24 defender spawn
];

// Named routes: a bot picks one at round start and walks it until it meets the enemy.
export const ROUTES = {
  A: [0, 1, 4, 10, 15, 20],
  B: [0, 2, 5, 11, 16, 21],
  MID: [0, 3, 9, 14, 19],
  A_MID: [0, 1, 7, 12, 14, 17, 20],
  B_MID: [0, 2, 8, 13, 14, 18, 21],
};
export const DEFEND_SPOTS = {
  A: [17, 22, 15, 19],
  B: [18, 23, 16, 19],
  MID: [14, 19, 12, 13],
};

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first search over the waypoint graph; returns waypoint indices from start to
// goal, inclusive. The graph is small, so this is cheap enough to run whenever a bot
// needs a new route.
export function findPath(startIndex, goalIndex) {
  if (startIndex === goalIndex) return [startIndex];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [startIndex];
  prev[startIndex] = startIndex;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of WAYPOINTS[current].links) {
      if (prev[next] !== -1) continue;
      prev[next] = current;
      if (next === goalIndex) {
        const path = [goalIndex];
        let node = goalIndex;
        while (node !== startIndex) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [startIndex, goalIndex];
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: name === 'rust' || name === 'teal' ? 0.25 : 0.03,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and perimeter: 56 x 44 m, 5 m walls, open sky so one sun reaches every lane.
  box(56.4, 0.4, 44.4, 0, -0.2, 0, 'ground');
  box(0.4, 5, 44.4, -28.2, 2.5, 0, 'surface');
  box(0.4, 5, 44.4, 28.2, 2.5, 0, 'surface');
  box(56.4, 5, 0.4, 0, 2.5, -22.2, 'surface');
  box(56.4, 5, 0.4, 0, 2.5, 22.2, 'surface');

  // The rail line down Mid: two steel rails on sleepers, plus a gantry that crosses it.
  box(0.18, 0.12, 40, -0.9, 0.06, 0, 'hairline', false);
  box(0.18, 0.12, 40, 0.9, 0.06, 0, 'hairline', false);
  for (let z = -19; z <= 19; z += 2) box(2.6, 0.05, 0.5, 0, 0.03, z, 'rust', false);
  box(1.1, 4.4, 1.1, -6, 2.2, 3, 'surface');
  box(1.1, 4.4, 1.1, 6, 2.2, 3, 'surface');
  box(13.2, 0.7, 1.4, 0, 4.6, 3, 'rust');

  // Freight containers: full-height blocks that split the lanes and make sightlines.
  box(6.2, 2.6, 2.6, -16, 1.3, 12, 'rust');
  box(6.2, 2.6, 2.6, 16, 1.3, 12, 'teal');
  box(2.6, 2.6, 6.2, -24, 1.3, 2, 'teal');
  box(2.6, 2.6, 6.2, 24, 1.3, 2, 'rust');
  box(6.2, 2.6, 2.6, -14, 1.3, -6, 'teal');
  box(6.2, 2.6, 2.6, 14, 1.3, -6, 'rust');
  box(5, 2.6, 2.6, -25, 1.3, -11, 'rust');
  box(5, 2.6, 2.6, 25, 1.3, -11, 'teal');

  // Crates: 1.1 m, crouch cover and jump-ups, scattered to break long sightlines.
  const crates = [
    [-7, 8, 1.4], [7, 8, 1.4], [-4, -2, 1.2], [4, -2, 1.2], [-10, 17, 1.4], [10, 17, 1.4],
    [-16, -2, 1.1], [16, -2, 1.1], [-6, -12, 1.2], [6, -12, 1.2], [-20, -18, 1.4], [20, -18, 1.4],
    [0, 16, 1.1], [-2, -16, 1.1], [2, -16, 1.1],
  ];
  for (const [x, z, size] of crates) box(size, 1.1, size, x, 0.55, z, 'hairline');
  // Stacked crates at the sites, so a planter has somewhere to hide.
  box(1.2, 1.1, 1.2, -17, 0.55, -16.5, 'hairline');
  box(1.2, 1.1, 1.2, -23, 0.55, -11.5, 'hairline');
  box(1.2, 1.1, 1.2, 17, 0.55, -16.5, 'hairline');
  box(1.2, 1.1, 1.2, 23, 0.55, -11.5, 'hairline');

  // Low walls that split the yard without blocking sightlines over them.
  box(8, 1.2, 0.5, -8, 0.6, -9, 'surface');
  box(8, 1.2, 0.5, 8, 0.6, -9, 'surface');
  box(0.5, 1.2, 8, -11, 0.6, 10, 'surface');
  box(0.5, 1.2, 8, 11, 0.6, 10, 'surface');

  // Site markers: a glowing ring on the ground and a post, so the plant zone reads at a
  // glance from across the yard. The ring is not a collider.
  const siteRings = [];
  for (const [key, site] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[key === 'A' ? 'siteA' : 'siteB']), transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    siteRings.push(ring);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 3.4, 0.3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE[key === 'A' ? 'siteA' : 'siteB']), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(PALETTE[key === 'A' ? 'siteA' : 'siteB']), emissiveIntensity: 0.35 }),
    );
    post.position.set(site.x, 1.7, site.z - site.radius - 0.6);
    post.castShadow = true;
    group.add(post);
  }

  // Light: a low amber sun from the south-west, a cool fill from the north, and a
  // sky/ground gradient so the yard reads as dusk, not noon.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a97ad'), new THREE.Color(PALETTE.ground), 0.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.4);
  sun.position.set(-18, 22, 16);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d90b5'), 0.5);
  fill.position.set(14, 12, -18);
  scene.add(fill);
  // Warm lamps over both sites, so the objective glows even in shadow.
  for (const site of Object.values(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 18, 1.8);
    lamp.position.set(site.x, 5.5, site.z);
    scene.add(lamp);
  }

  return { colliders, shootables, group, siteRings };
}
