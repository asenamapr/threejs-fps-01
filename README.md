# IRONLINE — a tactical FPS in Cinder Yard

A complete, original, round-based tactical FPS that runs offline from static files
in a desktop browser. Five against five in a dusk rail yard: Vanguard plants the
spark charge at Site A or Site B, Sentinel holds the sites and defuses. Short rounds,
money between rounds, a buy menu, and gunfire where stopping to aim pays.

Counter-Strike-style, never a copy: the map, the names, the art and the sounds are
all original.

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. No build step, no network
requests — `game/` is plain static files, three.js 0.187.0 vendored under
`game/vendor/three/`.

## How to play

- **W A S D** move, **mouse** look, **click** fire, **R** reload, **right-click** aim
- **Ctrl** crouch, **Space** jump
- **1–4** switch weapons (pistol, rifle, SMG, shotgun), **G** frag grenade, **F** flash
- **E** (hold) plant the charge inside a site ring — or defuse as Sentinel
- **B** opens the buy menu during the buy phase

Win a round by eliminating the other team, by detonating the planted charge, or —
as Sentinel — by defusing it or running the clock out. First to 8 rounds takes the
match. Kills pay $300, a round win pays $3,250, a loss pays $1,900 and grows with
each consecutive loss. Die and you lose the gun in hand.

## The game

- **Cinder Yard** (`game/src/map.js`): an original 56×44 m rail yard with three
  lanes (West Track, the rail line through Mid, East Track), freight containers,
  crates and low walls, two marked bomb sites, and a waypoint graph the bots walk.
- **Bots** (`game/src/bots.js`): nine bots with routes, hold positions, vision cones
  with line-of-sight checks, reaction delays, burst fire, hearing (gunshots pull
  them to investigate), site holds, retakes and defuses.
- **Gunplay** (`game/src/weapons.js`, `game/src/main.js`): hitscan weapons with
  headshot multipliers, recoil and spread that grow with movement speed and burst
  length, crouch and aim bonuses, tracers, muzzle flash and impact sparks.
- **Objective** (`game/src/bomb.js`): plant (3.2 s hold), 40 s fuse with quickening
  beeps, defuse (5 s hold), and a dropped charge a teammate can pick up.
- **Economy** (`game/src/economy.js`): per-round money, loss bonus, kill and plant
  rewards, death costs the gun in hand.
- **Sound** (`game/src/audio.js`): every sound is synthesised with WebAudio — no
  audio files, no network.
- **Simulation** (`game/src/main.js`): a fixed 60 Hz simulation kept apart from
  rendering, with pooled effects and no allocations in the hot loop.

## Layout

```
main.ts            the entry program: copies game/ + screenshots/ to /output and
                   writes /output/dossier.json with vendor/makefun-threejs.ts
serve.ts           tiny static server for local play (node serve.ts)
vendor/            the kit's makefun-threejs.ts, unchanged
game/
  index.html       the page, HUD and buy menu (one import map for three.js)
  src/             the game, one module per job
  vendor/three/    three.js 0.187.0, byte for byte from the kit
screenshots/       real renders of the game in headless Chromium
```

## License

MIT — see `LICENSE`.
