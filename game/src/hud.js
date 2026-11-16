// The DOM HUD: crosshair, hit marker, health, money, ammo, round timer, score, team
// counts, kill feed, bomb status and the buy menu. It never touches the simulation;
// main.js pushes numbers in and reads the buy clicks out.
import { WEAPONS, THROWABLES } from './weapons.js';

const BUY_ITEMS = [
  { key: '1', id: 'rifle' },
  { key: '2', id: 'smg' },
  { key: '3', id: 'shotgun' },
  { key: '4', id: 'frag' },
  { key: '5', id: 'flash' },
];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveVanguard = $('alive-vanguard');
  const aliveSentinel = $('alive-sentinel');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const bombBar = $('bomb-bar');
  const bombLabel = $('bomb-label');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyGrid = $('buy-grid');
  const flashOverlay = $('flash-overlay');
  const damageVignette = $('damage-vignette');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerCopy = $('banner-copy');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastBomb = '';

  const buyButtons = {};
  for (const item of BUY_ITEMS) {
    const def = WEAPONS[item.id] ?? THROWABLES[item.id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.id = item.id;
    button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
    buyGrid.appendChild(button);
    buyButtons[item.id] = button;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  return {
    onPlay(callback) { playButton.addEventListener('click', callback); },
    onBuy(callback) {
      for (const button of Object.values(buyButtons)) {
        button.addEventListener('click', () => callback(button.dataset.id));
      }
    },
    showOverlay(kind, score) {
      const copy = {
        start: ['IRONLINE', 'Five against five in Cinder Yard. Plant the spark charge at Site A or Site B — or eliminate Sentinel. Click to play.'],
        paused: ['IRONLINE', 'Paused. Click to resume.'],
        dead: ['You are down', 'Your squad fights on. The next round starts soon.'],
        match: [`Match over — ${score}`, 'Thanks for playing IRONLINE. Reload the page to run it back.'],
      }[kind];
      overlayTitle.textContent = copy[0];
      overlayCopy.textContent = copy[1];
      playButton.textContent = kind === 'start' ? 'Click to play' : kind === 'match' ? 'Play again' : 'Click to resume';
      overlay.hidden = false;
    },
    hideOverlay() { overlay.hidden = true; },
    setAmmo(mag, reserve, weaponName) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve} · ${weaponName}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(health) {
      if (health === lastHealth) return;
      lastHealth = health;
      healthValue.textContent = String(Math.max(0, Math.round(health)));
      healthBar.style.width = `${Math.max(0, health)}%`;
      healthBar.classList.toggle('low', health <= 30);
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds) {
      const text = formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', seconds <= 10);
    },
    setScore(vanguard, sentinel) {
      const text = `${vanguard} : ${sentinel}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
    },
    setAlive(vanguard, sentinel) {
      const text = `${vanguard}-${sentinel}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveVanguard.textContent = String(vanguard);
      aliveSentinel.textContent = String(sentinel);
    },
    setBomb(status, fuse, progress) {
      const text = `${status}|${Math.ceil(fuse)}|${Math.round(progress * 100)}`;
      if (text === lastBomb) return;
      lastBomb = text;
      if (status === 'planted') {
        bombBar.hidden = false;
        bombLabel.textContent = `CHARGE LIVE — ${formatTime(fuse)}`;
        bombBar.classList.add('live');
      } else if (status === 'planting' || status === 'defusing') {
        bombBar.hidden = false;
        bombLabel.textContent = status === 'planting' ? 'PLANTING…' : 'DEFUSING…';
        bombBar.classList.remove('live');
        bombBar.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
      } else {
        bombBar.hidden = true;
      }
    },
    setBombProgress(progress) {
      bombBar.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
    },
    hitMarker(killed, holdMs = 110) {
      hitmarker.classList.add('on');
      if (killed) hitmarker.classList.add('kill');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    setCrosshairGap(gapPx) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    killfeedAdd(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = `${killer}  ✕  ${victim}${headshot ? '  ◎' : ''}`;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
    },
    showBuy(money, owned) {
      buyMenu.hidden = false;
      buyMoney.textContent = `$${money}`;
      for (const item of BUY_ITEMS) {
        const button = buyButtons[item.id];
        const def = WEAPONS[item.id] ?? THROWABLES[item.id];
        button.disabled = money < def.price || (WEAPONS[item.id] && owned[item.id]);
        button.classList.toggle('owned', Boolean(WEAPONS[item.id] && owned[item.id]));
      }
    },
    hideBuy() { buyMenu.hidden = true; },
    showBanner(title, copy, ms = 2600) {
      bannerTitle.textContent = title;
      bannerCopy.textContent = copy;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    flashScreen(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { flashOverlay.style.opacity = '0'; }, 120);
      setTimeout(() => { flashOverlay.style.opacity = '0'; }, 900);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      setTimeout(() => damageVignette.classList.remove('on'), 180);
    },
  };
}
