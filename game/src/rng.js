// Deterministic RNG (mulberry32) so a screenshot seed replays the same round: the same
// bots take the same routes and the same shots land in the same places.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one element with the given RNG, and shuffle a copy of an array in place.
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}
export function shuffle(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = array[i];
    array[i] = array[j];
    array[j] = t;
  }
  return array;
}
