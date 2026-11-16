// Sound, synthesised with WebAudio — no audio files, no network. Gunfire is filtered
// noise, the reload is two clicks, the plant beep is a sine, the explosion is a low
// noise swell. Everything is created lazily on the first user gesture, so the page never
// tries to play before the browser allows it.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start(time);
    source.stop(time + duration);
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const time = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, time + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(envelope).connect(master);
    osc.start(time);
    osc.stop(time + duration);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'shotgun') burst(0.22, 900, 0.9);
      else if (kind === 'smg') burst(0.09, 1600, 0.5);
      else if (kind === 'pistol') burst(0.12, 1200, 0.6);
      else burst(0.14, 1100, 0.7);
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.5 - distance * 0.008);
      burst(0.12, 900, gain);
    },
    dryFire() { tone(1800, 0.04, 0.15, 'square'); },
    reload() {
      tone(900, 0.05, 0.2, 'square');
      setTimeout(() => tone(700, 0.05, 0.2, 'square'), 160);
    },
    hit() { tone(2400, 0.05, 0.25, 'sine'); },
    kill() { tone(1800, 0.07, 0.3, 'sine'); setTimeout(() => tone(2400, 0.09, 0.3, 'sine'), 70); },
    hurt() { burst(0.15, 500, 0.5); },
    beep() { tone(1200, 0.09, 0.3, 'sine'); },
    plant() { tone(880, 0.12, 0.3, 'sine'); setTimeout(() => tone(1320, 0.15, 0.3, 'sine'), 130); },
    explosion() {
      burst(0.9, 220, 1.0);
      tone(70, 0.8, 0.8, 'sine', 35);
    },
    click() { tone(1400, 0.04, 0.2, 'square'); },
    roundWin() {
      tone(523, 0.14, 0.3, 'sine');
      setTimeout(() => tone(659, 0.14, 0.3, 'sine'), 140);
      setTimeout(() => tone(784, 0.22, 0.3, 'sine'), 280);
    },
    roundLose() {
      tone(392, 0.16, 0.3, 'sine');
      setTimeout(() => tone(311, 0.24, 0.3, 'sine'), 160);
    },
    grenade() { burst(0.1, 2000, 0.3, 'highpass'); },
  };
}
