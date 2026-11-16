// The economy: money earned per round and spent in the buy menu between rounds. Win
// big, lose a little more each time in a row (the loss bonus), kill for cash, plant for
// cash. Die and you lose the gun you were holding — survival is worth money.
import { WEAPONS, THROWABLES } from './weapons.js';

const WIN_REWARD = 3250;
const LOSS_BASE = 1900;
const LOSS_STEP = 500;
const LOSS_CAP = 3400;
const KILL_REWARD = 300;
const PLANT_REWARD = 300;
const START_MONEY = 800;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    lossStreak: 0,
    owned: { pistol: true },
    grenades: { frag: 0, flash: 0 },
    equipped: 'pistol',
  };

  function buy(id) {
    const item = WEAPONS[id] ?? THROWABLES[id];
    if (!item) return false;
    if (state.money < item.price) return false;
    if (WEAPONS[id]) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      state.equipped = id;
    } else {
      state.grenades[id] += 1;
    }
    state.money -= item.price;
    return true;
  }

  function roundEnd(won, planted) {
    if (won) {
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.money += Math.min(LOSS_CAP, LOSS_BASE + state.lossStreak * LOSS_STEP);
      state.lossStreak += 1;
    }
    if (planted) state.money += PLANT_REWARD;
  }

  function onKill() {
    state.money += KILL_REWARD;
  }

  // Death costs the gun in hand; the pistol is always there to fall back on.
  function onDeath() {
    if (state.equipped !== 'pistol') {
      delete state.owned[state.equipped];
      state.equipped = 'pistol';
    }
    state.grenades = { frag: 0, flash: 0 };
  }

  function reset() {
    state.money = START_MONEY;
    state.lossStreak = 0;
    state.owned = { pistol: true };
    state.grenades = { frag: 0, flash: 0 };
    state.equipped = 'pistol';
  }

  return { state, buy, roundEnd, onKill, onDeath, reset };
}
