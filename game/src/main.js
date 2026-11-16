// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Rounds: buy (12 s) -> live (100 s) -> round end (4 s) -> next buy, first to 8 rounds.
// Vanguard (you + 4 bots) plants the spark charge at Site A or B; Sentinel (5 bots)
// holds the sites and defuses. Kill the other team, or play the objective.
// ?shot=start|mid|plant with &seed=N sets up a deterministic frame for a capture:
// it runs the simulation a fixed number of steps, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, pick } from './rng.js';
import { createMap, SITES, SPAWNS } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createViewModel, createWeaponState, weaponStep, weaponFire, weaponReload, weaponReady, weaponSpread, WEAPONS, THROWABLES } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects, createGrenade } from './effects.js';

const FIXED_STEP = 1 / 60;
const BUY_TIME = 12;
const ROUND_TIME = 100;
const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const freeMode = params.get('free') === '1'; // playtest hook: plays without pointer lock
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud();
const economy = createEconomy();
const bomb = createBomb(scene, SITES);
const bots = createBots(scene, map, random);
bots.spawnAll(SPAWNS.vanguard, SPAWNS.sentinel);
const player = createPlayer(map.colliders, SPAWNS.vanguard[1]);
const viewModel = createViewModel(camera);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const cameraForward = new THREE.Vector3();

// The round's one state object: everything the HUD and the bots read lives here.
const game = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1,
  score: { vanguard: 0, sentinel: 0 },
  buyLeft: BUY_TIME,
  roundLeft: ROUND_TIME,
  roundEndLeft: 0,
  liveTime: 0,
  roundWinner: null,
  roundReason: '',
  carrier: 'player', // 'player' | bot | null (dropped)
  roundSite: 'A',
  playerHealth: 100,
  kills: 0,
  deaths: 0,
  started: false,
  frozen: false,
  shotSteps: 0,
};

const playerEntity = {
  kind: 'player',
  alive: true,
  chestPos: new THREE.Vector3(),
  speed: 0,
  crouching: false,
  bot: null,
};
const botEntities = new Map();
for (const bot of bots.bots) {
  botEntities.set(bot.id, {
    kind: 'bot', alive: true, chestPos: new THREE.Vector3(), speed: 0, crouching: false, bot,
  });
}

let weaponState = createWeaponState(WEAPONS.pistol);
let grenades = [];
let hearEvents = [];
let lastBeepFuse = 0;
let flashBlindUntil = 0;
let elapsed = 0;

viewModel.show('pistol');
hud.setAmmo(weaponState.mag, weaponState.reserve, weaponState.def.name);
hud.setHealth(100);
hud.setMoney(economy.state.money);
hud.setScore(0, 0);
hud.setTimer(ROUND_TIME);
hud.setAlive(5, 5);

function onLockChange(locked) {
  if (shotMode) return;
  if (locked) {
    if (game.phase === 'menu') startMatch();
    hud.hideOverlay();
    audio.unlock();
  } else if (game.phase !== 'matchEnd' && game.phase !== 'menu') {
    if (player.state.alive) hud.showOverlay('paused');
    else hud.showOverlay('dead');
  }
}

hud.onPlay(() => {
  audio.unlock();
  if (game.phase === 'matchEnd') {
    startMatch();
    return;
  }
  if (game.phase === 'menu') {
    startMatch();
    return;
  }
  input.requestLock();
});

hud.onBuy((id) => {
  if (game.phase !== 'buy') return;
  buyItem(id);
});

function buyItem(id) {
  if (economy.buy(id)) {
    audio.click();
    if (WEAPONS[id]) equip(id);
    hud.setMoney(economy.state.money);
    hud.showBuy(economy.state.money, economy.state.owned);
    refreshAmmoHud();
  }
}

function equip(id) {
  if (!economy.state.owned[id]) return;
  economy.state.equipped = id;
  weaponState = createWeaponState(WEAPONS[id]);
  viewModel.show(id);
  refreshAmmoHud();
}

function refreshAmmoHud() {
  hud.setAmmo(weaponState.mag, weaponState.reserve, weaponState.def.name);
}

function startMatch() {
  game.score = { vanguard: 0, sentinel: 0 };
  game.round = 1;
  game.kills = 0;
  game.deaths = 0;
  economy.reset();
  hud.setMoney(economy.state.money);
  startRound();
}

function startRound() {
  game.phase = 'buy';
  game.buyLeft = BUY_TIME;
  game.roundLeft = ROUND_TIME;
  game.liveTime = 0;
  game.carrier = 'player';
  game.roundSite = pick(random, ['A', 'B']);
  game.playerHealth = 100;
  playerEntity.alive = true;
  player.respawn(SPAWNS.vanguard[1]);
  player.state.alive = true;
  bots.reset(random);
  bomb.reset();
  grenades.forEach((g) => g.remove());
  grenades = [];
  hearEvents = [];
  equip('pistol');
  if (economy.state.owned.rifle) equip('rifle');
  else if (economy.state.owned.smg) equip('smg');
  else if (economy.state.owned.shotgun) equip('shotgun');
  hud.hideBuy();
  hud.showBuy(economy.state.money, economy.state.owned);
  hud.showBanner(`Round ${game.round}`, `Plant the charge at Site ${game.roundSite} — or eliminate Sentinel.`, 3200);
  hud.setTimer(ROUND_TIME);
  hud.setScore(game.score.vanguard, game.score.sentinel);
  hud.setAlive(5, 5);
  hud.setHealth(100);
  hud.setBomb('carried', 0, 0);
  input.clearPressed();
}

function endRound(winner, reason) {
  if (game.phase !== 'live') return;
  game.phase = 'roundEnd';
  game.roundEndLeft = 4;
  game.roundWinner = winner;
  game.roundReason = reason;
  const won = winner === 'vanguard';
  game.score[winner] += 1;
  economy.roundEnd(won, bomb.state.status === 'planted' || bomb.state.status === 'exploded');
  hud.setMoney(economy.state.money);
  hud.setScore(game.score.vanguard, game.score.sentinel);
  hud.hideBuy();
  if (won) {
    hud.showBanner(`Round ${game.round} — Vanguard takes it`, reason, 3600);
    audio.roundWin();
  } else {
    hud.showBanner(`Round ${game.round} — Sentinel holds`, reason, 3600);
    audio.roundLose();
  }
}

function endMatch() {
  game.phase = 'matchEnd';
  const won = game.score.vanguard > game.score.sentinel;
  hud.showOverlay('match', won ? 'Vanguard wins the match' : 'Sentinel wins the match');
  document.exitPointerLock?.();
}

function playerDie(killerName) {
  if (!player.state.alive) return;
  player.state.alive = false;
  playerEntity.alive = false;
  game.deaths += 1;
  economy.onDeath();
  if (game.carrier === 'player' && (bomb.state.status === 'carried' || bomb.state.status === 'planting')) {
    bomb.drop(player.state.position);
    game.carrier = null;
    // The nearest living ally is sent to pick the charge up; it stays on the ground
    // until someone walks over it.
    let best = null;
    let bestD = Infinity;
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'vanguard') continue;
      const d = bot.position.distanceToSquared(player.state.position);
      if (d < bestD) { bestD = d; best = bot; }
    }
    if (best) best.isCarrier = true;
  }
  hud.setHealth(0);
  if (!shotMode) hud.showOverlay('dead'); // staged captures keep the live view
  audio.hurt();
  if (game.phase === 'live') checkRoundEnd();
}

function damagePlayer(amount, attackerName, headshot) {
  if (!player.state.alive || game.phase !== 'live') return;
  game.playerHealth -= amount;
  hud.setHealth(game.playerHealth);
  hud.damageFlash();
  audio.hurt();
  if (game.playerHealth <= 0) {
    game.playerHealth = 0;
    hud.killfeedAdd(attackerName, 'You', headshot);
    playerDie(attackerName);
  }
}

function damageBot(bot, amount, part, killerName, killerIsPlayer) {
  if (!bot.alive) return;
  const killed = bots.damage(bot, amount, part, killerName);
  if (killed) {
    hud.killfeedAdd(killerName, bot.name, part === 'head');
    if (killerIsPlayer) {
      game.kills += 1;
      economy.onKill();
      hud.setMoney(economy.state.money);
      audio.kill();
    }
    if (bot.isCarrier) {
      bot.isCarrier = false;
      // Only drop the charge if this bot was actually carrying it; a bot on its way
      // to pick it up leaves it where it lies.
      if (bomb.state.status === 'carried') {
        bomb.drop(bot.position);
        game.carrier = null;
      }
    }
    checkRoundEnd();
  } else if (killerIsPlayer) {
    audio.hit();
  }
}

function checkRoundEnd() {
  if (game.phase !== 'live') return;
  const vanguardAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard');
  const sentinelAlive = bots.aliveCount('sentinel');
  if (sentinelAlive === 0) endRound('vanguard', 'Sentinel eliminated.');
  else if (vanguardAlive === 0) endRound('sentinel', 'Vanguard eliminated.');
}

function shoot() {
  if (!weaponFire(weaponState)) {
    if (weaponState.mag === 0) audio.dryFire();
    return;
  }
  viewModel.fire();
  audio.shot(weaponState.def.id);
  player.recoil(weaponState.def.kick, (random() - 0.5) * weaponState.def.kick * 0.5);
  camera.getWorldDirection(cameraForward);
  const spread = weaponSpread(weaponState, player.groundSpeed(), player.state.crouching);
  const pellets = weaponState.def.pellets ?? 1;
  let anyHit = false;
  for (let p = 0; p < pellets; p += 1) {
    direction.copy(cameraForward);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    raycaster.set(camera.position, direction);
    const targets = map.shootables.concat(bots.hitMeshes());
    const hits = raycaster.intersectObjects(targets, false);
    const end = hits.length > 0 ? hits[0].point : camera.position.clone().addScaledVector(direction, 90);
    muzzle.copy(camera.position).addScaledVector(cameraForward, 0.5);
    muzzle.y -= 0.12;
    muzzle.x += Math.cos(player.state.yaw) * 0.12;
    effects.tracer(muzzle, end);
    hearEvents.push({ x: player.state.position.x, z: player.state.position.z });
    if (hits.length > 0) {
      const hit = hits[0];
      hitPoint.copy(hit.point);
      const userData = hit.object.userData;
      if (userData.bot) {
        const distance = hit.distance;
        const falloff = weaponState.def.id === 'shotgun' ? Math.max(0.4, 1 - distance / 26) : 1;
        const damage = weaponState.def.damage * (userData.part === 'head' ? weaponState.def.headMult : 1) * falloff;
        damageBot(userData.bot, damage, userData.part, 'You', true);
        hud.hitMarker(userData.bot.health <= 0);
        anyHit = true;
      } else {
        effects.impact(hitPoint);
      }
    }
  }
  refreshAmmoHud();
  if (!anyHit && weaponState.mag === 0) refreshAmmoHud();
}

function throwGrenade(kind) {
  if (economy.state.grenades[kind] <= 0) return;
  economy.state.grenades[kind] -= 1;
  camera.getWorldDirection(cameraForward);
  const start = camera.position.clone().addScaledVector(cameraForward, 0.6);
  start.y -= 0.1;
  grenades.push(createGrenade(scene, start, cameraForward, kind, random));
  audio.grenade();
}

function resolveGrenade(grenade) {
  const pos = grenade.state.position;
  if (grenade.state.kind === 'frag') {
    effects.explosion(pos, THROWABLES.frag.radius);
    audio.explosion();
    const victims = [];
    if (player.state.alive) victims.push({ entity: playerEntity, isPlayer: true });
    for (const bot of bots.bots) if (bot.alive) victims.push({ entity: botEntities.get(bot.id), isPlayer: false });
    for (const victim of victims) {
      const targetPos = victim.entity.chestPos;
      const distance = Math.hypot(targetPos.x - pos.x, targetPos.z - pos.z) + Math.abs(targetPos.y - pos.y) * 0.5;
      if (distance < THROWABLES.frag.radius) {
        const damage = THROWABLES.frag.damage * (1 - distance / THROWABLES.frag.radius);
        if (victim.isPlayer) damagePlayer(damage, 'Frag-7', false);
        else damageBot(victim.entity.bot, damage, 'body', 'You', true);
      }
    }
  } else {
    // Flash: white out the player's screen if they face it, blind bots that face it.
    audio.beep();
    const toFlash = new THREE.Vector3().copy(pos).sub(camera.position);
    const distance = toFlash.length();
    if (distance < THROWABLES.flash.radius && player.state.alive) {
      camera.getWorldDirection(cameraForward);
      const facing = cameraForward.dot(toFlash.normalize());
      if (facing > 0.1) hud.flashScreen(Math.max(0.25, 1 - distance / THROWABLES.flash.radius));
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const dx = pos.x - bot.position.x;
      const dz = pos.z - bot.position.z;
      const d = Math.hypot(dx, dz);
      if (d > THROWABLES.flash.radius) continue;
      const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (forward.dot(new THREE.Vector3(dx / d, 0, dz / d)) > -0.2) {
        bot.reactionLeft = Math.max(bot.reactionLeft, 2.5);
        bot.target = null;
        bot.state = 'hold';
      }
    }
  }
}

// One fixed simulation step. Rendering reads the same state; nothing here allocates in
// the hot loop beyond the few vectors the grenade path needs.
function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;

  if (game.phase === 'buy') {
    game.buyLeft -= dt;
    if (input.wasPressed('KeyB')) {
      if (document.getElementById('buy-menu').hidden) hud.showBuy(economy.state.money, economy.state.owned);
      else hud.hideBuy();
    }
    for (const item of ['rifle', 'smg', 'shotgun', 'frag', 'flash']) {
      const code = { rifle: 'Digit1', smg: 'Digit2', shotgun: 'Digit3', frag: 'Digit4', flash: 'Digit5' }[item];
      if (input.wasPressed(code)) buyItem(item);
    }
    if (game.buyLeft <= 0) {
      game.phase = 'live';
      hud.hideBuy();
      hud.showBanner('Round live', `Plant at Site ${game.roundSite}. Good luck.`, 2200);
    }
  }

  if (game.phase === 'roundEnd') {
    game.roundEndLeft -= dt;
    if (game.roundEndLeft <= 0) {
      if (game.score.vanguard >= WIN_ROUNDS || game.score.sentinel >= WIN_ROUNDS || game.round >= MAX_ROUNDS) endMatch();
      else {
        game.round += 1;
        startRound();
      }
    }
  }

  const live = game.phase === 'live';
  const canMove = live || game.phase === 'buy';

  // Look + movement.
  if (canMove && player.state.alive && input.state.locked) {
    const look = input.takeLook();
    player.look(look.x, look.y, player.state.aiming ? 0.0011 : 0.0021);
  }
  if (canMove && player.state.alive) {
    player.step(dt, keys, input.state.aiming === true);
    if (input.wasPressed('KeyR') && weaponReload(weaponState)) {
      viewModel.startReload(weaponState.def.reload);
      audio.reload();
    }
    if (input.wasPressed('KeyG')) throwGrenade('frag');
    if (input.wasPressed('KeyF')) throwGrenade('flash');
    const switchKeys = { Digit1: 'pistol', Digit2: 'rifle', Digit3: 'smg', Digit4: 'shotgun' };
    for (const [code, id] of Object.entries(switchKeys)) {
      if (input.wasPressed(code) && live) equip(id);
    }
  }

  // Firing (hold for autos, click for semi-autos is approximated by the cooldown).
  // The camera is synced here so a scripted aim in the same step already points the
  // shot; the loop's sync after the step batch is only for rendering.
  syncCamera();
  if (live && player.state.alive && input.state.firing && input.state.locked) {
    if (weaponState.def.auto) shoot();
    else if (weaponReady(weaponState)) shoot();
  }
  weaponStep(weaponState, dt);
  viewModel.step(dt, economy.state.equipped);

  // Camera follows the player.
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  const targetFov = player.state.aiming && input.state.locked ? 55 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  // Bots step first: they report who is planting or defusing this step, and the bomb
  // step below consumes it. Bots only move once the round is live; buy phase is frozen.
  let planterHolding = false;
  let planterPosition = null;
  let defuserHolding = false;
  let defuserPosition = null;
  playerEntity.chestPos.set(player.state.position.x, player.state.position.y + 1.35, player.state.position.z);
  playerEntity.alive = player.state.alive;
  playerEntity.speed = player.groundSpeed();
  playerEntity.crouching = player.state.crouching;
  for (const bot of bots.bots) {
    const entity = botEntities.get(bot.id);
    entity.alive = bot.alive;
    entity.chestPos.set(bot.position.x, 1.35, bot.position.z);
    entity.speed = 0;
  }
  const vanguardFoes = bots.bots.filter((b) => b.team === 'sentinel').map((b) => botEntities.get(b.id));
  const sentinelFoes = [playerEntity, ...bots.bots.filter((b) => b.team === 'vanguard').map((b) => botEntities.get(b.id))];
  const bombSite = bomb.state.status === 'planted' || bomb.state.status === 'defusing' ? SITES[bomb.state.site] : null;
  const world = {
    enemies: null,
    hearEvents,
    liveTime: game.liveTime,
    bombPlanted: bombSite !== null,
    bombSite,
    bombDropped: bomb.state.status === 'dropped',
    dropPos: bomb.state.dropPos,
    plantSite: SITES[game.roundSite],
    defuser: null,
    planter: null,
    onBotShot(bot, target, hit, head) {
      // Tracer from the bot's gun to the target, whether the shot lands or not.
      const from = new THREE.Vector3(bot.position.x, 1.45, bot.position.z);
      const to = target.chestPos.clone();
      if (!hit) {
        to.x += (random() - 0.5) * 2.5;
        to.y += (random() - 0.5) * 1.5;
        to.z += (random() - 0.5) * 2.5;
      }
      effects.tracer(from, to);
      audio.enemyShot(bot.position.distanceTo(player.state.position));
      hearEvents.push({ x: bot.position.x, z: bot.position.z });
      if (!hit) return;
      // A bot's headshot hurts double, not quadruple: the player's headshot is the
      // one that should end a duel in one bullet, not a bot's.
      const damage = bot.weapon.damage * (head ? 2 : 1);
      if (target.kind === 'player') damagePlayer(damage, bot.name, head);
      else damageBot(target.bot, damage, head ? 'head' : 'body', bot.name, false);
    },
  };
  if (live) {
    for (const bot of bots.bots) {
      world.enemies = bot.team === 'vanguard' ? vanguardFoes : sentinelFoes;
      world.defuser = null;
      world.planter = null;
      bots.stepBot(bot, dt, world);
      if (world.defuser) {
        defuserHolding = true;
        defuserPosition = world.defuser.position;
      }
      if (world.planter) {
        planterHolding = true;
        planterPosition = world.planter.position;
      }
      // A living ally walks over the dropped charge and picks it up.
      if (bomb.state.status === 'dropped' && bot.alive && bot.team === 'vanguard' && (game.carrier === null || bot.isCarrier)) {
        const dropPos = bomb.state.dropPos;
        if (dropPos && bot.position.distanceTo(dropPos) < 1.4) {
          bomb.pickup();
          bot.isCarrier = true;
          game.carrier = bot;
        }
      }
    }
  }

  // Bomb: the player plants by holding E in a site; a bot planter or defuser the bots
  // reported above does the same. The fuse runs once the charge is in.
  if (live) {
    if (game.carrier === 'player' && player.state.alive && keys.has('KeyE')) {
      planterHolding = true;
      planterPosition = player.state.position;
    }
    if (bomb.state.status === 'dropped' && player.state.alive) {
      const dropPos = bomb.state.dropPos;
      if (dropPos && player.state.position.distanceTo(dropPos) < 1.4) {
        bomb.pickup();
        game.carrier = 'player';
      }
    }
  }
  const bombEvent = bomb.step(dt, planterHolding, planterPosition, defuserHolding, defuserPosition);
  if (bombEvent === 'planted') {
    game.carrier = null; // nobody carries it any more; it is in the ground
    hud.showBanner('Charge planted', 'Sentinel has 40 seconds to defuse it. Hold the site.', 3200);
    audio.plant();
  } else if (bombEvent === 'defused') {
    endRound('sentinel', 'Charge defused.');
  } else if (bombEvent === 'exploded') {
    const site = SITES[bomb.state.site];
    effects.explosion(new THREE.Vector3(site.x, 0.5, site.z), 9);
    audio.explosion();
    endRound('vanguard', 'Charge detonated.');
  }
  if (bomb.state.status === 'planted' || bomb.state.status === 'defusing') {
    const fuse = bomb.state.fuse;
    if (Math.ceil(fuse) !== Math.ceil(lastBeepFuse)) audio.beep();
    lastBeepFuse = fuse;
    hud.setBomb(bomb.state.status, fuse, bomb.state.progress);
  } else if (bomb.state.status === 'planting') {
    hud.setBomb('planting', 0, bomb.state.progress);
  } else {
    hud.setBomb('carried', 0, 0);
  }
  hearEvents = [];

  // Grenades fly and resolve.
  for (const grenade of grenades) {
    grenade.step(dt, map.colliders);
    if (grenade.state.done) resolveGrenade(grenade);
  }
  grenades = grenades.filter((g) => !g.state.done);
  effects.step(dt);

  // Round timer and round-end checks.
  if (live) {
    game.liveTime += dt;
    if (bomb.state.status === 'planted' || bomb.state.status === 'defusing') {
      hud.setTimer(bomb.state.fuse);
    } else {
      game.roundLeft -= dt;
      hud.setTimer(game.roundLeft);
      if (game.roundLeft <= 0) endRound('sentinel', 'Time expired — the charge was never planted.');
    }
  }

  // HUD numbers.
  refreshAmmoHud();
  hud.setHealth(game.playerHealth);
  hud.setMoney(economy.state.money);
  hud.setAlive(
    (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard'),
    bots.aliveCount('sentinel'),
  );
  const spreadPx = 3 + weaponSpread(weaponState, player.groundSpeed(), player.state.crouching) * 900;
  hud.setCrosshairGap(spreadPx);

  // Deterministic screenshot modes: run a fixed number of steps, then freeze. Freeze
  // early if the round ends first, so the frame shows the round that was scripted.
  if (shotMode) {
    game.shotSteps += 1;
    if (shotMode === 'mid') {
      // Scripted burst: between steps 200 and 250 the player aims at the nearest
      // living Sentinel and fires, so the frame catches the fight mid-burst.
      if (game.shotSteps >= 200 && game.shotSteps < 250) {
        let best = null;
        let bestD = Infinity;
        for (const bot of bots.bots) {
          if (!bot.alive || bot.team !== 'sentinel') continue;
          const d = bot.position.distanceToSquared(player.state.position);
          if (d < bestD) { bestD = d; best = bot; }
        }
        if (best) {
          const dx = best.position.x - player.state.position.x;
          const dy = 1.35 - (player.state.position.y + player.state.eye);
          const dz = best.position.z - player.state.position.z;
          const length = Math.hypot(dx, dy, dz) || 1;
          player.state.yaw = Math.atan2(-dx, -dz);
          player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
          input.state.firing = true;
        }
      } else {
        input.state.firing = false;
      }
    }
    const target = shotMode === 'start' ? 20 : shotMode === 'mid' ? 300 : 240;
    if (game.shotSteps >= target || game.phase === 'roundEnd') {
      game.frozen = true;
      document.getElementById('banner').hidden = true; // staged frames show the game, not a banner
      window.__shotReady = true;
    }
  }
}

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

// ---- Screenshot setup: deterministic positions and a scripted beat per mode. ----
function setupShot() {
  if (!shotMode) return;
  hud.hideOverlay();
  startMatch();
  economy.state.money = 4000;
  economy.buy('rifle');
  economy.buy('frag');
  equip('rifle');
  hud.setMoney(economy.state.money);
  input.state.locked = true; // shot mode plays without pointer lock
  if (shotMode === 'start') {
    // Buy phase at spawn, looking up Mid toward the gantry.
    player.state.yaw = 0;
    player.state.pitch = 0.02;
  } else if (shotMode === 'mid') {
    game.phase = 'live';
    game.buyLeft = 0;
    hud.hideBuy();
    player.respawn({ x: 0, z: 12, yaw: 0.15 });
    player.state.pitch = 0;
  } else if (shotMode === 'plant') {
    game.phase = 'live';
    game.buyLeft = 0;
    hud.hideBuy();
    player.respawn({ x: -19, z: -13, yaw: -0.9 });
    player.state.pitch = -0.01;
    // The plant is pre-staged at 85%: the scripted hold finishes it in half a second,
    // through the real plant path, before the defenders can close in.
    bomb.state.status = 'planting';
    bomb.state.site = 'A';
    bomb.state.progress = 0.85;
    // Scripted plant: the player stands in Site A holding E until the charge is in.
    // KeyE is added synchronously: the sim runs hundreds of steps per frame, so a
    // wall-clock interval might not fire before the plant finishes.
    input.state.keys.add('KeyE');
    const plantInterval = setInterval(() => {
      if (game.frozen || bomb.state.status === 'planted') {
        clearInterval(plantInterval);
        return;
      }
      input.state.keys.add('KeyE');
      player.state.position.set(-20, 0, -14);
    }, 50);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// The loop: fixed-step simulation, render at display rate, freeze in shot mode.
// In shot mode the sim runs as fast as the CPU allows (240 steps a frame) instead of
// tracking wall time, so a deterministic capture does not wait on the renderer.
let accumulator = 0;
let lastTime = performance.now();
function loop(now) {
  if (game.frozen) {
    syncCamera();
    renderer.render(scene, camera);
    return;
  }
  if (shotMode) {
    let steps = 0;
    while (!game.frozen && steps < 240) {
      step(FIXED_STEP);
      steps += 1;
    }
    syncCamera();
    renderer.render(scene, camera);
    if (!game.frozen) requestAnimationFrame(loop);
    return;
  }
  const frameDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
    if (game.frozen) break;
  }
  if (steps === 5) accumulator = 0;
  syncCamera();
  renderer.render(scene, camera);
  if (!game.frozen) requestAnimationFrame(loop);
}

if (shotMode) {
  setupShot();
} else if (freeMode) {
  hud.hideOverlay();
  startMatch();
  input.state.locked = true;
} else {
  hud.showOverlay('start');
}
window.__game = game;
window.__player = player;
window.__bots = bots;
window.__bomb = bomb;
window.__economy = economy;
requestAnimationFrame(loop);
