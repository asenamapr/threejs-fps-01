// The bots: nine of them, four Vanguard allies and five Sentinel enemies. A bot walks a
// route through the waypoint graph, holds a position, and fights what it can see: line
// of sight, a field of view and a reaction delay before it opens fire, bursts with
// distance-based accuracy, and a strafe while it engages. It hears gunshots and goes to
// look, it converges on a planted charge, and it defuses when the site is clear. Bots
// never see through walls and never shoot what they cannot see.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, ROUTES, DEFEND_SPOTS, nearestWaypoint, findPath } from './map.js';
import { WEAPONS } from './weapons.js';
import { pick, shuffle } from './rng.js';

const BOT_SPEED = 3.9;
const VISION_RANGE = 40;
const VISION_HALF_ANGLE = 1.15;
const HEAR_RANGE = 26;
const ROUND_START_GRACE = 2.5; // bots leave spawn before they open fire
const BOT_RADIUS = 0.36;

const ALLY_NAMES = ['Rook', 'Hale', 'Mira', 'Doss'];
const ENEMY_NAMES = ['Vex', 'Kade', 'Nils', 'Omar', 'Sable'];

function buildBotMesh(team) {
  const group = new THREE.Group();
  const torsoColor = team === 'vanguard' ? PALETTE.vanguard : PALETTE.sentinel;
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.62, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(torsoColor), roughness: 0.7, metalness: 0.1 }),
  );
  torso.position.y = 1.05;
  torso.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a37e'), roughness: 0.8 }),
  );
  head.position.y = 1.55;
  head.castShadow = true;
  const helmet = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.14, 0.34),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 }),
  );
  helmet.position.y = 1.72;
  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.72, 0.26),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262c'), roughness: 0.9 }),
  );
  legs.position.y = 0.36;
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.55),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#15171b'), roughness: 0.5, metalness: 0.4 }),
  );
  gun.position.set(0.2, 1.15, -0.3);
  group.add(torso, head, helmet, legs, gun);
  return { group, torso, head, gun };
}

export function createBots(scene, map, random) {
  const bots = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const toTarget = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const probe = new THREE.Box3();

  function makeBot(id, name, team, spawn) {
    const parts = buildBotMesh(team);
    parts.group.position.set(spawn.x, 0, spawn.z);
    parts.group.rotation.y = spawn.yaw ?? 0;
    scene.add(parts.group);
    const weaponId = random() < 0.7 ? 'rifle' : 'smg';
    const bot = {
      id,
      name,
      team,
      weapon: WEAPONS[weaponId],
      alive: true,
      health: 100,
      position: parts.group.position,
      yaw: spawn.yaw ?? 0,
      state: 'advance', // advance | hold | engage | investigate | plant | defuse | dead
      route: [],
      routeIndex: 0,
      holdSpot: -1,
      holdTime: 0,
      target: null,
      targetPos: new THREE.Vector3(),
      reactionLeft: 0,
      burstLeft: 0,
      shotTimer: 0,
      visionTimer: Math.random() * 0.15,
      hearPos: null,
      strafeDir: 1,
      strafeTimer: 0,
      fallProgress: 0,
      skill: (team === 'vanguard' ? 0.85 : 0.7) + random() * 0.45,
      isCarrier: false,
      mesh: parts.group,
      torso: parts.torso,
      head: parts.head,
    };
    parts.torso.userData = { bot, part: 'body' };
    parts.head.userData = { bot, part: 'head' };
    parts.group.userData = { bot };
    bots.push(bot);
    return bot;
  }

  function spawnAll(vanguardSpawns, sentinelSpawns) {
    for (let i = 0; i < 4; i += 1) makeBot(`ally-${i}`, ALLY_NAMES[i], 'vanguard', vanguardSpawns[i]);
    for (let i = 0; i < 5; i += 1) makeBot(`enemy-${i}`, ENEMY_NAMES[i], 'sentinel', sentinelSpawns[i]);
  }

  function reset(roundRandom) {
    for (const bot of bots) {
      bot.alive = true;
      bot.health = 100;
      bot.state = 'advance';
      bot.target = null;
      bot.hearPos = null;
      bot.fallProgress = 0;
      bot.isCarrier = false;
      bot.mesh.rotation.x = 0;
      bot.mesh.visible = true;
      const spawns = bot.team === 'vanguard'
        ? [{ x: -4, z: 19, yaw: 0 }, { x: 0, z: 19.5, yaw: 0 }, { x: 4, z: 19, yaw: 0 }, { x: -8, z: 18, yaw: 0.3 }]
        : [{ x: -4, z: -19, yaw: Math.PI }, { x: 0, z: -19.5, yaw: Math.PI }, { x: 4, z: -19, yaw: Math.PI }, { x: -8, z: -18, yaw: Math.PI - 0.3 }, { x: 8, z: -18, yaw: Math.PI + 0.3 }];
      const index = bot.team === 'vanguard' ? Number(bot.id.split('-')[1]) : Number(bot.id.split('-')[1]);
      const spawn = spawns[index];
      bot.position.set(spawn.x, 0, spawn.z);
      bot.yaw = spawn.yaw;
      bot.mesh.rotation.y = spawn.yaw;
      if (bot.team === 'vanguard') {
        const routeKeys = shuffle(roundRandom, ['A', 'B', 'MID', 'A_MID', 'B_MID']);
        bot.route = ROUTES[routeKeys[Number(bot.id.split('-')[1]) % routeKeys.length]].slice();
        bot.routeIndex = 1;
      } else {
        const spots = shuffle(roundRandom, [...DEFEND_SPOTS.A, ...DEFEND_SPOTS.B, ...DEFEND_SPOTS.MID]);
        bot.holdSpot = spots[Number(bot.id.split('-')[1]) % spots.length];
        bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), bot.holdSpot);
        bot.routeIndex = 1;
      }
    }
  }

  function blocked(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, 1.7, z + BOT_RADIUS);
    for (const collider of map.colliders) {
      if (probe.intersectsBox(collider)) return true;
    }
    return false;
  }

  // Line of sight: a ray from the bot's eyes to the target's chest that hits nothing in
  // the world first. The world mesh list is the only thing that can block it.
  function canSee(bot, targetPos) {
    toTarget.copy(targetPos).sub(bot.position);
    toTarget.y = 1.35 - 1.5;
    const distance = toTarget.length();
    if (distance > VISION_RANGE) return false;
    dir.copy(toTarget).normalize();
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (forward.dot(dir) < Math.cos(VISION_HALF_ANGLE) && distance > 4) return false;
    raycaster.set(new THREE.Vector3(bot.position.x, 1.5, bot.position.z), dir);
    raycaster.far = distance;
    const hits = raycaster.intersectObjects(map.shootables, false);
    return hits.length === 0;
  }

  function moveToward(bot, targetX, targetZ, dt, speed = BOT_SPEED) {
    const dx = targetX - bot.position.x;
    const dz = targetZ - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.15) return true;
    const stepX = (dx / distance) * speed * dt;
    const stepZ = (dz / distance) * speed * dt;
    const nextX = bot.position.x + stepX;
    const nextZ = bot.position.z + stepZ;
    if (!blocked(nextX, bot.position.z)) bot.position.x = nextX;
    if (!blocked(bot.position.x, nextZ)) bot.position.z = nextZ;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.mesh.rotation.y = bot.yaw;
    return distance < 0.4;
  }

  function hitChance(bot, target, distance) {
    const targetSpeed = target.speed ?? 0;
    let chance = 0.3 - distance * 0.006 - targetSpeed * 0.02;
    if (target.crouching) chance -= 0.08;
    if (bot.state === 'engage') chance += 0.04;
    return Math.max(0.05, Math.min(0.32, chance)) * bot.skill;
  }

  // One bot's turn. `world` carries what the bot needs from the round: the living
  // enemies (player + bots), the bomb state, and the callbacks that fire a shot or
  // report a death. Returns nothing; effects go through the callbacks.
  function stepBot(bot, dt, world) {
    if (!bot.alive) {
      if (bot.fallProgress < 1) {
        bot.fallProgress = Math.min(1, bot.fallProgress + dt * 3);
        bot.mesh.rotation.x = -Math.PI / 2 * bot.fallProgress * 0.9;
        bot.mesh.position.y = 0.25 * bot.fallProgress;
      }
      return;
    }
    bot.visionTimer -= dt;
    if (bot.visionTimer <= 0) {
      bot.visionTimer = 0.15;
      bot.target = null;
      // Nearest usually wins, but a random spread keeps all five bots from dogpiling
      // the same target the moment it appears.
      let bestScore = Infinity;
      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
        const pos = enemy.chestPos;
        const distance = Math.hypot(pos.x - bot.position.x, pos.z - bot.position.z);
        const score = distance + random() * 18;
        if (score > bestScore) continue;
        if (canSee(bot, pos)) {
          bot.target = enemy;
          bestScore = score;
          bot.targetPos.copy(pos);
        }
      }
      if (bot.target && bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactionLeft = 0.35 + random() * 0.45;
        bot.burstLeft = 0;
      } else if (!bot.target && bot.state === 'engage') {
        bot.state = bot.routeIndex < bot.route.length ? 'advance' : 'hold';
      }
    }

    // Hearing: a gunshot nearby pulls a bot off its route to look.
    if (world.hearEvents.length > 0 && bot.state !== 'engage' && !bot.isCarrier) {
      for (const event of world.hearEvents) {
        const distance = Math.hypot(event.x - bot.position.x, event.z - bot.position.z);
        if (distance < HEAR_RANGE && distance > 3) {
          bot.hearPos = { x: event.x, z: event.z };
          bot.state = 'investigate';
          bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(event.x, event.z));
          bot.routeIndex = 1;
        }
      }
    }

    // Objective: after the plant, attackers hold the site and defenders converge on it.
    if (world.bombPlanted && bot.team === 'sentinel' && bot.state !== 'engage' && bot.state !== 'defuse') {
      const site = world.bombSite;
      bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(site.x, site.z));
      bot.routeIndex = 1;
      bot.state = 'advance';
      bot.objective = 'retake';
    }
    if (world.bombPlanted && bot.team === 'vanguard' && bot.state !== 'engage' && bot.state !== 'plant') {
      const site = world.bombSite;
      const distance = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
      if (distance > 6) {
        bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(site.x, site.z));
        bot.routeIndex = 1;
        bot.state = 'advance';
      } else {
        bot.state = 'hold';
        bot.holdTime = 0;
      }
    }

    // Defuse: a defender standing on the site with no enemy in sight starts the defuse.
    if (world.bombPlanted && bot.team === 'sentinel' && bot.state !== 'engage') {
      const site = world.bombSite;
      const distance = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
      if (distance < 3.5) {
        bot.state = 'defuse';
      }
    }
    if (bot.state === 'defuse') {
      world.defuser = bot;
      return;
    }

    // Carrier: an ally holding the charge walks it to the nearest site and plants. If
    // the charge is on the ground, the carrier walks to it first and picks it up.
    if (bot.isCarrier && bot.state !== 'engage' && bot.state !== 'plant') {
      if (world.bombDropped && world.dropPos) {
        const dropDistance = Math.hypot(world.dropPos.x - bot.position.x, world.dropPos.z - bot.position.z);
        if (dropDistance > 1.5) {
          bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(world.dropPos.x, world.dropPos.z));
          bot.routeIndex = 1;
          bot.state = 'advance';
        }
        return;
      }
      const site = world.bombSite ?? world.plantSite;
      if (site) {
        const distance = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
        if (distance < 3) {
          bot.state = 'plant';
        } else {
          bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(site.x, site.z));
          bot.routeIndex = 1;
          bot.state = 'advance';
        }
      }
    }
    if (bot.state === 'plant') {
      world.planter = bot;
      return;
    }

    if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe a little, and fire in bursts after the reaction delay.
      const dx = bot.targetPos.x - bot.position.x;
      const dz = bot.targetPos.z - bot.position.z;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.mesh.rotation.y = bot.yaw;
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.7 + random() * 0.8;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const strafeX = Math.cos(bot.yaw) * bot.strafeDir * 1.1 * dt;
      const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir * 1.1 * dt;
      if (!blocked(bot.position.x + strafeX, bot.position.z)) bot.position.x += strafeX;
      if (!blocked(bot.position.x, bot.position.z + strafeZ)) bot.position.z += strafeZ;
      if (bot.reactionLeft > 0) {
        bot.reactionLeft -= dt;
        return;
      }
      // Nobody opens fire in the first seconds of a round: both teams are still
      // leaving spawn, and a spawn-to-spawn cross-map kill is not a firefight.
      if (world.liveTime < ROUND_START_GRACE) return;
      bot.shotTimer -= dt;
      if (bot.shotTimer <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 2);
          bot.shotTimer = 1.0 + random() * 0.8;
        } else {
          bot.burstLeft -= 1;
          bot.shotTimer = bot.weapon.gap * (1.4 + random() * 0.5);
          const distance = Math.hypot(dx, dz);
          const hit = random() < hitChance(bot, bot.target, distance);
          const head = hit && random() < 0.06;
          world.onBotShot(bot, bot.target, hit, head);
        }
      }
      return;
    }

    if (bot.state === 'advance' || bot.state === 'investigate') {
      if (bot.routeIndex >= bot.route.length) {
        bot.state = 'hold';
        bot.holdTime = 0;
        return;
      }
      const waypoint = WAYPOINTS[bot.route[bot.routeIndex]];
      const arrived = moveToward(bot, waypoint.x, waypoint.z, dt);
      if (arrived) bot.routeIndex += 1;
      return;
    }

    if (bot.state === 'hold') {
      bot.holdTime += dt;
      // Scan: slowly turn to watch the lane.
      bot.yaw += Math.sin(bot.holdTime * 0.5) * dt * 0.4;
      bot.mesh.rotation.y = bot.yaw;
      if (bot.holdTime > 6 + random() * 4 && bot.team === 'vanguard' && !world.bombPlanted) {
        // Attackers get impatient and push the next site.
        bot.route = findPath(nearestWaypoint(bot.position.x, bot.position.z), nearestWaypoint(world.plantSite.x, world.plantSite.z));
        bot.routeIndex = 1;
        bot.state = 'advance';
      }
    }
  }

  function damage(bot, amount, part, killer) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.state = 'dead';
      bot.fallProgress = 0;
      return true;
    }
    return false;
  }

  function aliveCount(team) {
    let count = 0;
    for (const bot of bots) if (bot.alive && bot.team === team) count += 1;
    return count;
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (bot.alive) meshes.push(bot.torso, bot.head);
    }
    return meshes;
  }

  return {
    bots,
    spawnAll,
    reset,
    stepBot,
    damage,
    aliveCount,
    hitMeshes,
    pick,
  };
}
