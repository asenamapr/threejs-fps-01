// Player movement: acceleration toward a wish direction, friction when idle, gravity and
// a jump, crouch that lowers the eye and the body, all resolved as a capsule-sized box
// against the map's colliders one axis at a time so a wall never swallows the player.
// Speed is the lever gunplay pulls on: spread grows with ground speed, so stopping to aim
// pays and firing on the move is punished.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.14;
const STAND_EYE = 1.58;
const CROUCH_EYE = 1.0;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const AIM_SPEED = 3.4;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const GRAVITY = 22;
const JUMP_SPEED = 6.4;

export function createPlayer(colliders, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    aiming: false,
    height: STAND_HEIGHT,
    alive: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the
  // floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.5, Math.min(1.5, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.5, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys, aiming) {
    if (!body.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    body.aiming = aiming;
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = body.crouching ? CROUCH_SPEED : body.aiming ? AIM_SPEED : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (keys.has('Space') && body.onGround && !body.crouching) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.05)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.05)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-32, body.velocity.y);
  }

  function respawn(spawnPoint) {
    body.position.set(spawnPoint.x, 0, spawnPoint.z);
    body.velocity.set(0, 0, 0);
    body.yaw = spawnPoint.yaw ?? 0;
    body.pitch = 0;
    body.eye = STAND_EYE;
    body.height = STAND_HEIGHT;
    body.crouching = false;
    body.alive = true;
    body.onGround = true;
  }

  return {
    state: body,
    step,
    look,
    recoil,
    respawn,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
  };
}
