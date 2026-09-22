// Card-table sound effects, synthesized with Web Audio (no sound files needed).
const SFX = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true, volume = 0.7;
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noise() {
    if (!noiseBuf) {
      const c = ac();
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // A short filtered burst of noise: the snap of a card.
  function flick(t, { freq = 2400, q = 0.9, dur = 0.06, gain = 0.5 } = {}) {
    const c = ctx, src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noise();
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.03);
  }
  function tone(t, f, { type = 'sine', dur = 0.3, gain = 0.22, attack = 0.008, to = null } = {}) {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function play(fn) {
    if (!enabled) return;
    try { const c = ac(); if (!c) return; fn(c.currentTime + 0.01); } catch (e) { /* sound is optional */ }
  }
  const api = {
    unlock() { try { ac(); } catch (e) {} },
    setEnabled(v) { enabled = !!v; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    deal() { play(t => { for (let i = 0; i < 18; i++) flick(t + i * 0.05, { freq: 2000 + Math.random() * 1400, dur: 0.045, gain: 0.32 }); }); },
    discard() { play(t => { for (let i = 0; i < 5; i++) flick(t + i * 0.12, { freq: 1300, q: 0.6, dur: 0.16, gain: 0.26 }); }); },
    card() { play(t => { flick(t, { freq: 1900, dur: 0.07, gain: 0.55 }); tone(t + 0.005, 170, { dur: 0.09, gain: 0.25, to: 90 }); }); },
    trickWin() { play(t => { tone(t, 659, { type: 'triangle', dur: 0.2, gain: 0.2 }); tone(t + 0.09, 988, { type: 'triangle', dur: 0.32, gain: 0.2 }); }); },
    trickLose() { play(t => { tone(t, 392, { dur: 0.2, gain: 0.16 }); tone(t + 0.11, 311, { dur: 0.3, gain: 0.14 }); }); },
    handWin() { play(t => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, { type: 'triangle', dur: 0.5, gain: 0.2 })); }); },
    handLose() { play(t => { [440, 392, 349, 294].forEach((f, i) => tone(t + i * 0.16, f, { dur: 0.45, gain: 0.16 })); }); },
    gameWin() { play(t => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, { type: 'triangle', dur: 0.6, gain: 0.2 })); [523, 659, 784].forEach(f => tone(t + 0.8, f, { type: 'triangle', dur: 1.2, gain: 0.12 })); }); },
    gameLose() { play(t => { [392, 370, 349, 262].forEach((f, i) => tone(t + i * 0.22, f, { dur: 0.6, gain: 0.16 })); }); },
    ping() { play(t => { tone(t, 1319, { dur: 0.5, gain: 0.2 }); tone(t + 0.13, 1760, { dur: 0.7, gain: 0.16 }); }); },
  };
  return api;
})();
