/* Sound: synthesised effects and music (Web Audio, no files), plus narration.
 * In recording mode every sound is logged with its engine time instead of
 * played, and renderOffline() mixes the soundtrack for the cartoon videos. */
AT.audio = (() => {
  let ctx = null, master, musicBus, sfxBus, voiceBus, duck;
  let muted = false;
  let musicOn = true;
  const rec = { on: false, events: [] };
  const noiseCache = new WeakMap();
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  try { muted = localStorage.getItem('atticus-muted') === '1'; } catch (e) { /* storage blocked */ }

  function build(c) {
    const m = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    m.connect(comp); comp.connect(c.destination);
    const mb = c.createGain(), sb = c.createGain(), vb = c.createGain(), dk = c.createGain();
    mb.gain.value = 0.32; sb.gain.value = 0.6; vb.gain.value = 1.0;
    mb.connect(dk); dk.connect(m); sb.connect(m); vb.connect(m);
    return { master: m, musicBus: mb, sfxBus: sb, voiceBus: vb, duck: dk };
  }
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    ({ master, musicBus, sfxBus, voiceBus, duck } = build(ctx));
    master.gain.value = muted ? 0 : 1;
  }
  // Sound pauses for two reasons, which can overlap: 'refit', while the game clock is
  // paused (sprites being repainted after a resize: hold()), so narration does not run
  // ahead of the still scene; and 'hidden', while the page is hidden (see 'page hidden'
  // below). The context is suspended when the first reason starts, if it was running, and
  // resumed only when the last one ends (so coming back to the page mid-repaint stays quiet).
  const pausedFor = new Set();
  let resumeAfter = false;
  function pauseSound(why, on) {
    if (on === pausedFor.has(why)) return;
    const was = pausedFor.size > 0;
    if (on) pausedFor.add(why); else pausedFor.delete(why);
    if (!ctx || rec.on) return;
    const quiet = (p) => { if (p && p.catch) p.catch(() => {}); };
    try {
      if (on && !was) { resumeAfter = ctx.state === 'running'; if (resumeAfter && ctx.suspend) quiet(ctx.suspend()); }
      else if (!on && !pausedFor.size && resumeAfter) { resumeAfter = false; quiet(ctx.resume()); }
    } catch (e) { /* old Web Audio */ }
  }
  function hold(on) { pauseSound('refit', !!on); }
  function unlock() {
    init();
    if (!ctx) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
    if (pausedFor.size) resumeAfter = true; // resumed when the pause ends
    else if (ctx.state !== 'running') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    if (prefetched !== voiceScene) prefetchScene();
  }

  // ---------- building blocks ----------
  function noise(c) {
    if (noiseCache.has(c)) return noiseCache.get(c);
    const len = c.sampleRate * 2;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 7;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    noiseCache.set(c, b);
    return b;
  }
  function env(c, g, t, a, peak, dec, sus = 0, rel = 0.05, hold = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + hold + dec);
    if (sus) g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + dec + rel);
  }
  function osc(c, out, type, f, t, dur, vol = 0.3, o = {}) {
    const g = c.createGain();
    const os = c.createOscillator();
    os.type = type;
    os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dur));
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib; lg.gain.value = o.vibAmt || f * 0.03;
      l.connect(lg); lg.connect(os.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    env(c, g, t, o.a || 0.005, vol, dur, 0, 0.05, o.hold || 0);
    let node = os;
    if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; node.connect(f2); node = f2; }
    node.connect(g); g.connect(out);
    os.start(t); os.stop(t + (o.hold || 0) + dur + 0.1);
    return os;
  }
  function nz(c, out, t, dur, vol, type = 'bandpass', freq = 1000, q = 1, o = {}) {
    const s = c.createBufferSource();
    s.buffer = noise(c);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = c.createGain();
    env(c, g, t, o.a || 0.005, vol, dur, 0, 0.05, o.hold || 0);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + (o.hold || 0) + dur + 0.1);
    return { s, f, g };
  }
  // formant voice for baby noises: f0 contour + vowel formants
  function vox(c, out, t, dur, f0, f0to, formants, vol = 0.25, o = {}) {
    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t);
    src.frequency.linearRampToValueAtTime(f0to, t + dur);
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib; lg.gain.value = f0 * 0.04; l.connect(lg); lg.connect(src.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    const g = c.createGain();
    env(c, g, t, o.a || 0.02, vol, dur * 0.9, 0, 0.05, dur * 0.1);
    formants.forEach(([fq, gain, q]) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q || 8;
      const fg = c.createGain(); fg.gain.value = gain;
      src.connect(bp); bp.connect(fg); fg.connect(g);
    });
    g.connect(out);
    src.start(t); src.stop(t + dur + 0.1);
  }
  const VOWEL = {
    ee: [[420, 1.4, 6], [2900, 0.6, 10], [3600, 0.3, 12]],
    ah: [[1000, 1.4, 6], [1600, 0.8, 8], [3200, 0.25, 10]],
    oo: [[420, 1.6, 6], [1000, 0.6, 8], [2600, 0.15, 10]],
  };

  // ---------- sound effects: (c, out, t, opts) ----------
  const SFX = {
    tap: (c, o, t) => osc(c, o, 'sine', 700, t, 0.08, 0.25, { to: 420, glide: 0.08 }),
    pop: (c, o, t) => { osc(c, o, 'sine', 380, t, 0.09, 0.35, { to: 1300, glide: 0.06 }); nz(c, o, t, 0.03, 0.12, 'highpass', 3000); },
    boing: (c, o, t) => osc(c, o, 'sine', 180, t, 0.5, 0.35, { to: 520, glide: 0.18, vib: 14, vibAmt: 40 }),
    wiggle: (c, o, t) => { for (let i = 0; i < 4; i++) osc(c, o, 'triangle', 420 + (i % 2) * 140, t + i * 0.16, 0.14, 0.18, { vib: 18, vibAmt: 30 }); },
    rumble: (c, o, t) => {
      nz(c, o, t, 1.1, 0.5, 'lowpass', 160, 2, { a: 0.1 });
      osc(c, o, 'sine', 70, t, 1.0, 0.35, { vib: 7, vibAmt: 18, a: 0.08 });
    },
    tinkle: (c, o, t) => {
      for (let i = 0; i < 16; i++) osc(c, o, 'sine', midi(84 + [0, 4, 7, 12, 9, 5, 2, 11][i % 8]), t + i * 0.11 + Math.random() * 0.03, 0.25, 0.09);
      nz(c, o, t, 1.6, 0.06, 'bandpass', 4200, 2, { a: 0.1, hold: 0.2 });
    },
    plop: (c, o, t) => { osc(c, o, 'sine', 620, t, 0.22, 0.5, { to: 110, glide: 0.18 }); nz(c, o, t + 0.12, 0.3, 0.12, 'bandpass', 1800, 1.5); },
    flush: (c, o, t) => {
      nz(c, o, t, 2.2, 0.45, 'lowpass', 3500, 1, { to: 260, a: 0.08, hold: 0.3 });
      nz(c, o, t, 1.8, 0.2, 'bandpass', 900, 3, { to: 300, a: 0.2 });
      for (let i = 0; i < 6; i++) osc(c, o, 'sine', 300 + Math.random() * 300, t + 1 + i * 0.18, 0.08, 0.12, { to: 900 });
    },
    paper: (c, o, t) => { for (let i = 0; i < 5; i++) nz(c, o, t + i * 0.07, 0.06, 0.25, 'bandpass', 2500 + i * 300, 1.2); },
    fwip: (c, o, t, p = {}) => nz(c, o, t, 0.28, 0.35, 'bandpass', p.up ? 600 : 2600, 2, { to: p.up ? 2600 : 500 }),
    poof: (c, o, t) => nz(c, o, t, 0.5, 0.4, 'lowpass', 1200, 0.8, { to: 300 }),
    water: (c, o, t, p = {}) => nz(c, o, t, p.dur || 1.5, 0.22, 'bandpass', 2000, 0.8, { a: 0.08, hold: (p.dur || 1.5) - 0.3 }),
    scrub: (c, o, t) => nz(c, o, t, 0.07, 0.22, 'bandpass', 3200 + Math.random() * 1500, 1.5),
    squish: (c, o, t) => { nz(c, o, t, 0.4, 0.3, 'lowpass', 500, 4, { to: 1600 }); osc(c, o, 'sine', 200, t, 0.35, 0.15, { to: 500 }); },
    spit: (c, o, t) => { nz(c, o, t, 0.16, 0.5, 'bandpass', 1400, 1.2); osc(c, o, 'sine', 180, t + 0.04, 0.12, 0.3, { to: 80 }); nz(c, o, t + 0.12, 0.25, 0.15, 'highpass', 3000); },
    gargle: (c, o, t) => {
      const n = nz(c, o, t, 1.1, 0.3, 'bandpass', 700, 3, { a: 0.05, hold: 0.6 });
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 22; lg.gain.value = 400; l.connect(lg); lg.connect(n.f.frequency); l.start(t); l.stop(t + 1.3);
    },
    ding: (c, o, t) => { osc(c, o, 'sine', 1318, t, 0.7, 0.25); osc(c, o, 'sine', 2637, t, 0.4, 0.08); },
    sparkle: (c, o, t) => { [84, 88, 91, 96, 100].forEach((m, i) => osc(c, o, 'sine', midi(m), t + i * 0.06, 0.4, 0.13)); },
    star: (c, o, t) => { osc(c, o, 'square', midi(83), t, 0.12, 0.08, { lp: 3000 }); osc(c, o, 'square', midi(88), t + 0.1, 0.4, 0.1, { lp: 3000 }); osc(c, o, 'sine', midi(100), t + 0.1, 0.5, 0.08); },
    fanfare: (c, o, t) => {
      const seq = [[67, 0, 0.14], [72, 0.15, 0.14], [76, 0.3, 0.14], [79, 0.45, 0.5], [76, 0.75, 0.14], [79, 0.9, 0.9]];
      seq.forEach(([m, d, l]) => { osc(c, o, 'sawtooth', midi(m), t + d, l, 0.12, { lp: 2400, a: 0.02, hold: l * 0.5 }); osc(c, o, 'square', midi(m - 12), t + d, l, 0.05, { lp: 1200, hold: l * 0.5 }); });
      [72, 76, 79].forEach((m) => osc(c, o, 'triangle', midi(m), t + 0.9, 1.2, 0.08, { hold: 0.3 }));
    },
    clap: (c, o, t) => { for (let i = 0; i < 3; i++) nz(c, o, t + i * 0.01, 0.09, 0.35, 'bandpass', 1300, 1.3); },
    applause: (c, o, t) => { for (let i = 0; i < 40; i++) nz(c, o, t + Math.random() * 1.8, 0.06, 0.12 + Math.random() * 0.1, 'bandpass', 900 + Math.random() * 1600, 1.4); },
    giggle: (c, o, t, p = {}) => {
      const base = p.f0 || 480;
      for (let i = 0; i < 5; i++) {
        const f = base * (1.12 - i * 0.05);
        vox(c, o, t + i * 0.13, 0.09, f * 1.05, f, VOWEL.ee, 0.22, { a: 0.008 });
        nz(c, o, t + i * 0.13, 0.05, 0.05, 'highpass', 3000);
      }
    },
    coo: (c, o, t) => vox(c, o, t, 0.5, 380, 560, VOWEL.oo, 0.25, { vib: 6 }),
    cry: (c, o, t) => { vox(c, o, t, 0.7, 440, 520, VOWEL.ah, 0.18, { vib: 7 }); vox(c, o, t + 0.8, 0.6, 500, 400, VOWEL.ah, 0.16, { vib: 7 }); },
    burp: (c, o, t) => {
      const s = osc(c, o, 'sawtooth', 95, t, 0.45, 0.32, { to: 70, lp: 600, a: 0.02 });
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 28; lg.gain.value = 25; l.connect(lg); lg.connect(s.frequency); l.start(t); l.stop(t + 0.6);
      nz(c, o, t, 0.35, 0.12, 'lowpass', 500, 2);
    },
    gulp: (c, o, t) => { for (let i = 0; i < 3; i++) osc(c, o, 'sine', 520, t + i * 0.32, 0.12, 0.3, { to: 220, glide: 0.1 }); },
    kiss: (c, o, t) => { nz(c, o, t, 0.05, 0.3, 'bandpass', 2500, 2); osc(c, o, 'sine', 500, t + 0.04, 0.18, 0.2, { to: 1200 }); },
    shh: (c, o, t) => nz(c, o, t, 1.0, 0.2, 'highpass', 3500, 0.7, { a: 0.15, hold: 0.3 }),
    wrong: (c, o, t) => { osc(c, o, 'triangle', midi(67), t, 0.18, 0.2); osc(c, o, 'triangle', midi(64), t + 0.2, 0.3, 0.2); },
    whoosh: (c, o, t) => nz(c, o, t, 0.5, 0.3, 'bandpass', 400, 1.5, { to: 3000, a: 0.15 }),
    toot: (c, o, t) => { osc(c, o, 'square', 620, t, 0.5, 0.1, { lp: 1800, hold: 0.25, vib: 6 }); osc(c, o, 'square', 740, t, 0.5, 0.08, { lp: 1800, hold: 0.25, vib: 6 }); },
    squeak: (c, o, t) => osc(c, o, 'sine', 1100, t, 0.25, 0.25, { to: 1600, glide: 0.1, vib: 25, vibAmt: 80 }),
    bounce: (c, o, t) => osc(c, o, 'sine', 160, t, 0.25, 0.4, { to: 340, glide: 0.08 }),
    block: (c, o, t) => { osc(c, o, 'sine', 820, t, 0.1, 0.3); osc(c, o, 'triangle', 1400, t, 0.05, 0.12); },
    tumble: (c, o, t) => { for (let i = 0; i < 4; i++) { osc(c, o, 'sine', 700 - i * 80, t + i * 0.11, 0.1, 0.25); } },
    yawn: (c, o, t) => vox(c, o, t, 1.1, 420, 260, VOWEL.ah, 0.14, { a: 0.2 }),
    wheee: (c, o, t) => osc(c, o, 'sine', 500, t, 0.6, 0.18, { to: 1500, glide: 0.5, vib: 10, vibAmt: 50 }),
    bug: (c, o, t) => SFX.giggle(c, o, t, { f0: 900 }),
    swish: (c, o, t) => nz(c, o, t, 0.35, 0.25, 'bandpass', 1200, 1, { to: 3000 }),
    magic: (c, o, t) => { [72, 76, 79, 84, 88, 91].forEach((m, i) => osc(c, o, 'sine', midi(m), t + i * 0.05, 0.6, 0.1)); },
    peek: (c, o, t) => { osc(c, o, 'sine', midi(76), t, 0.15, 0.2); osc(c, o, 'sine', midi(84), t + 0.18, 0.3, 0.2); },
  };

  // ---------- music ----------
  // note lists: [beat, midi, lengthBeats, velocity]
  const prog = (chords, beatsPer, fn) => chords.flatMap((ch, i) => fn(ch, i * beatsPer));
  const C = [60, 64, 67], G = [55, 59, 62], Am = [57, 60, 64], F = [53, 57, 60], Dm = [50, 53, 57];
  const TRACKS = {
    happy: {
      bpm: 112, len: 32,
      parts: [
        ['pluck', prog([C, G, Am, F, C, G, F, G], 4, (ch, b) => [0, 1, 2, 3].flatMap((k) => [[b + k, ch[k % 3] + 12, 0.9, 0.5], [b + k + 0.5, ch[(k + 1) % 3] + 12, 0.5, 0.3]]))],
        ['bass', prog([C, G, Am, F, C, G, F, G], 4, (ch, b) => [[b, ch[0] - 12, 1.5, 0.8], [b + 2, ch[0] - 12, 1.5, 0.6]])],
        ['bell', [[0, 76, 1], [1, 79, 1], [2, 81, 1], [3, 79, 1], [4, 79, 2], [6, 74, 2], [8, 76, 1], [9, 72, 1], [10, 76, 2], [12, 77, 1.5], [14, 76, 0.5], [14.5, 74, 1.5],
          [16, 76, 1], [17, 79, 1], [18, 84, 1.5], [20, 83, 1], [21, 79, 1], [22, 74, 2], [24, 77, 1], [25, 76, 1], [26, 74, 2], [28, 74, 1], [29, 76, 1], [30, 79, 2]].map(([b, m, l]) => [b, m, l, 0.55])],
        ['shaker', Array.from({ length: 64 }, (_, i) => [i * 0.5, 0, 0.1, i % 2 ? 0.5 : 0.25])],
      ],
    },
    play: {
      bpm: 96, len: 32,
      parts: [
        ['pluck', prog([F, C, Dm, C, F, C, G, C], 4, (ch, b) => [0, 1, 2, 3].map((k) => [b + k, ch[[0, 1, 2, 1][k]] + 12, 0.9, 0.35]))],
        ['bass', prog([F, C, Dm, C, F, C, G, C], 4, (ch, b) => [[b, ch[0] - 12, 3, 0.6]])],
        ['bell', [[0, 81, 2], [2, 79, 2], [4, 76, 3], [8, 77, 2], [10, 76, 1], [11, 74, 1], [12, 72, 4], [16, 81, 2], [18, 84, 2], [20, 83, 2], [22, 79, 2], [24, 77, 2], [26, 79, 2], [28, 76, 4]].map(([b, m, l]) => [b, m, l, 0.35])],
      ],
    },
    brush: {
      bpm: 128, len: 16,
      parts: [
        ['bass', prog([C, F, G, C], 4, (ch, b) => [[b, ch[0] - 12, 0.5, 0.8], [b + 1, ch[0], 0.4, 0.5], [b + 2, ch[0] - 12, 0.5, 0.8], [b + 3, ch[2] - 12, 0.4, 0.5]])],
        ['marimba', [[0, 72], [0.5, 72], [1, 76], [2, 79], [3, 76], [4, 77], [4.5, 77], [5, 81], [6, 77], [7, 74], [8, 79], [8.5, 79], [9, 83], [10, 79], [11, 77], [12, 76], [13, 74], [14, 72], [15, 72]].map(([b, m]) => [b, m, 0.5, 0.6])],
        ['shaker', Array.from({ length: 32 }, (_, i) => [i * 0.5, 0, 0.1, i % 2 ? 0.6 : 0.3])],
        ['kick', Array.from({ length: 8 }, (_, i) => [i * 2, 0, 0.2, 0.7])],
      ],
    },
    lullaby: {
      bpm: 76, len: 48,
      parts: [
        // Twinkle Twinkle Little Star (traditional)
        ['box', [[0, 72], [1, 72], [2, 79], [3, 79], [4, 81], [5, 81], [6, 79, 2], [8, 77], [9, 77], [10, 76], [11, 76], [12, 74], [13, 74], [14, 72, 2],
          [16, 79], [17, 79], [18, 77], [19, 77], [20, 76], [21, 76], [22, 74, 2], [24, 79], [25, 79], [26, 77], [27, 77], [28, 76], [29, 76], [30, 74, 2],
          [32, 72], [33, 72], [34, 79], [35, 79], [36, 81], [37, 81], [38, 79, 2], [40, 77], [41, 77], [42, 76], [43, 76], [44, 74], [45, 74], [46, 72, 2]].map(([b, m, l]) => [b, m, l || 1, 0.5])],
        ['pad', [[0, C], [4, F], [6, C], [8, F], [10, C], [12, G], [14, C], [16, C], [18, F], [20, C], [22, G], [24, C], [26, F], [28, C], [30, G], [32, C], [36, F], [38, C], [40, F], [42, C], [44, G], [46, C]].map(([b, ch], i, a) => [b, ch, ((a[i + 1] || [48])[0]) - b, 0.3])],
      ],
    },
    party: {
      bpm: 128, len: 16,
      parts: [
        ['bass', prog([C, Am, F, G], 4, (ch, b) => [0, 1, 2, 3].map((k) => [b + k, ch[0] - 12 + (k % 2) * 12, 0.45, 0.7]))],
        ['pluck', prog([C, Am, F, G], 4, (ch, b) => [0.5, 1.5, 2.5, 3.5].map((k) => [b + k, ch[1] + 12, 0.3, 0.45]))],
        ['bell', [[0, 79], [1, 79], [1.5, 81], [2, 79], [3, 84], [4, 83, 2], [6, 79], [7, 76], [8, 77], [9, 77], [9.5, 79], [10, 77], [11, 81], [12, 79, 2], [14, 74], [15, 76]].map(([b, m, l]) => [b, m, l || 0.8, 0.5])],
        ['kick', Array.from({ length: 16 }, (_, i) => [i, 0, 0.2, 0.6])],
        ['shaker', Array.from({ length: 32 }, (_, i) => [i * 0.5, 0, 0.1, i % 2 ? 0.6 : 0.3])],
      ],
    },
  };
  const INST = {
    pluck: (c, o, t, m, d, v) => { osc(c, o, 'triangle', midi(m), t, 0.5 + d * 0.2, 0.22 * v); osc(c, o, 'sawtooth', midi(m), t, 0.18, 0.05 * v, { lp: 2200 }); },
    bell: (c, o, t, m, d, v) => { osc(c, o, 'sine', midi(m), t, 1.0, 0.2 * v); osc(c, o, 'sine', midi(m) * 2.76, t, 0.3, 0.05 * v); },
    box: (c, o, t, m, d, v) => { osc(c, o, 'sine', midi(m), t, 1.6, 0.22 * v); osc(c, o, 'sine', midi(m) * 3.0, t, 0.25, 0.05 * v); osc(c, o, 'sine', midi(m) * 5.4, t, 0.08, 0.02 * v); },
    marimba: (c, o, t, m, d, v) => { osc(c, o, 'sine', midi(m), t, 0.35, 0.28 * v); osc(c, o, 'sine', midi(m) * 4, t, 0.06, 0.06 * v); },
    bass: (c, o, t, m, d, v, spb) => osc(c, o, 'triangle', midi(m), t, Math.min(0.6, d * spb), 0.4 * v),
    shaker: (c, o, t, m, d, v) => nz(c, o, t, 0.05, 0.08 * v, 'highpass', 6000, 0.8),
    kick: (c, o, t, m, d, v) => osc(c, o, 'sine', 140, t, 0.18, 0.5 * v, { to: 45, glide: 0.12 }),
    pad: (c, o, t, ch, d, v, spb) => ch.forEach((m) => osc(c, o, 'triangle', midi(m - 12), t, d * spb, 0.05 * v, { a: 0.4, hold: d * spb * 0.5, lp: 900 })),
  };
  function scheduleTrack(c, out, name, startTime, fromT, toT) {
    // schedule every note whose time (relative to startTime) is in [fromT, toT)
    const tr = TRACKS[name];
    const spb = 60 / tr.bpm;
    const loopLen = tr.len * spb;
    const firstLoop = Math.floor(fromT / loopLen);
    const lastLoop = Math.floor(toT / loopLen);
    for (let L = firstLoop; L <= lastLoop; L++) {
      for (const [inst, notes] of tr.parts) {
        for (const [b, m, d, v] of notes) {
          const rt = L * loopLen + b * spb;
          if (rt >= fromT && rt < toT) INST[inst](c, out, startTime + rt, m, d, v, spb);
        }
      }
    }
  }

  // live music player
  let cur = null;   // {name, start, scheduledTo, gain, timer}
  function music(name) {
    if (rec.on) { rec.events.push({ t: AT.engine.time, type: 'music', name }); return; }
    if (cur && cur.name === name) return;
    stopMusic();
    if (!name || !ctx) { cur = name ? { name, pending: true } : null; return; }
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6);
    g.connect(musicBus);
    const m = { name, start: ctx.currentTime + 0.1, scheduledTo: 0, gain: g };
    m.timer = setInterval(() => {
      if (!musicOn) return;
      const now = ctx.currentTime - m.start;
      const ahead = now + 0.35;
      if (ahead > m.scheduledTo) {
        scheduleTrack(ctx, g, name, m.start, Math.max(m.scheduledTo, now - 0.01), ahead);
        m.scheduledTo = ahead;
      }
    }, 90);
    cur = m;
  }
  function stopMusic() {
    if (rec.on) { rec.events.push({ t: AT.engine.time, type: 'music', name: null }); return; }
    if (!cur) return;
    if (cur.timer) clearInterval(cur.timer);
    if (cur.gain && ctx) {
      const g = cur.gain;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      setTimeout(() => g.disconnect(), 700);
    }
    cur = null;
  }

  // ---------- sfx ----------
  function sfx(name, opts) {
    if (rec.on) { rec.events.push({ t: AT.engine.time, type: 'sfx', name, opts }); return; }
    if (!ctx || ctx.state !== 'running' || !SFX[name]) return;
    SFX[name](ctx, sfxBus, ctx.currentTime + 0.01, opts || {});
  }

  // ---------- voice ----------
  // Narration comes in two parts. js/voice-index.js (loaded with the game) has the
  // text, speaker and duration of every line, so captions and timing never wait.
  // The MP3 audio arrives after the game has booted: js/voice-data.js calls
  // AT.addVoiceAudio() (and js/voice-cartoons.js adds the cartoon-only lines in
  // ?record mode). Each scene's lines are decoded ahead of time, one by one, and
  // only VOICE_KEEP bytes of decoded audio are kept.
  const VOICE_KEEP = 8e6;    // decoded narration kept (about 40 s at 48 kHz)
  const VOICE_AHEAD = 5e6;   // decoded ahead when a scene starts
  const VOICE_WAIT = 1.5;    // seconds a line asked for before its audio has loaded may wait
  const voiceBufs = new Map(); // id -> AudioBuffer, least recently used first
  const decoding = new Map();  // id -> Promise<AudioBuffer|null>
  const vstats = { voiceBytes: 0, peakVoiceBytes: 0, decodes: 0, played: 0, waited: 0, dropped: 0, fallbacks: 0 };
  let voiceLoaded = false, voiceMissing = false, voiceLoadedResolve, voiceSettle;
  let voiceScene = null, sceneIds = new Set(), prefetched = null, prefetchGen = 0;
  let voiceSeq = 0; // bumped by stopVoice(), so lines still loading or decoding don't play late
  AT.voiceReady = new Promise((r) => { voiceLoadedResolve = r; });
  // settles once the audio has arrived, or the page has finished loading without it
  const voiceSettled = new Promise((r) => { voiceSettle = r; });
  window.addEventListener('load', () => { if (!voiceLoaded) { voiceMissing = true; voiceSettle(); } });
  AT.addVoiceAudio = (map, part) => {
    const V = window.AT_VOICE = window.AT_VOICE || {};
    for (const id in map) (V[id] = V[id] || { s: 'N', t: '', d: 1.5 }).a = map[id];
    if (part === 'cartoons' || voiceLoaded) return;
    voiceLoaded = true;
    try { performance.mark('at:voice'); } catch (e) { /* old browsers */ }
    voiceLoadedResolve();
    voiceSettle();
    prefetchScene();
  };
  // ?record mode: the cartoons also say lines that normal play never does.
  function loadCartoonVoices() {
    const loaded = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/voice-cartoons.js';
      s.onload = resolve;
      s.onerror = () => { console.error('could not load js/voice-cartoons.js'); resolve(); };
      document.body.appendChild(s);
    });
    return Promise.all([loaded, AT.voiceReady]);
  }

  const b64ToBuf = (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  function decodeVoice(c, id) {
    const V = window.AT_VOICE && window.AT_VOICE[id];
    if (!V || !V.a) return Promise.resolve(null);
    return new Promise((res) => {
      try {
        const p = c.decodeAudioData(b64ToBuf(V.a), res, () => res(null));
        if (p && p.catch) p.catch(() => res(null));
      } catch (e) { res(null); }
    });
  }
  const sizeOf = (b) => b.length * b.numberOfChannels * 4;
  // A line's decoded audio if it is kept (and mark it as recently used).
  function cachedVoice(id) {
    const b = voiceBufs.get(id);
    if (b) { voiceBufs.delete(id); voiceBufs.set(id, b); }
    return b;
  }
  // A line's decoded audio, decoding it (once) if needed.
  function voiceBuf(id) {
    const b = cachedVoice(id);
    if (b) return Promise.resolve(b);
    if (decoding.has(id)) return decoding.get(id);
    const c = ctx;
    vstats.decodes++;
    const p = decodeVoice(c, id).then((buf) => {
      decoding.delete(id);
      if (buf && c === ctx) keepVoice(id, buf);
      return buf;
    });
    decoding.set(id, p);
    return p;
  }
  function keepVoice(id, buf) {
    if (voiceBufs.has(id)) vstats.voiceBytes -= sizeOf(voiceBufs.get(id));
    voiceBufs.set(id, buf);
    vstats.voiceBytes += sizeOf(buf);
    vstats.peakVoiceBytes = Math.max(vstats.peakVoiceBytes, vstats.voiceBytes);
    // over budget: forget the least recently used lines, other scenes' lines first
    for (const otherScenes of [true, false]) {
      for (const [k, b] of voiceBufs) {
        if (vstats.voiceBytes <= VOICE_KEEP) return;
        if (k === id || (otherScenes && sceneIds.has(k))) continue;
        voiceBufs.delete(k);
        vstats.voiceBytes -= sizeOf(b);
      }
    }
  }
  // AT.go(name) calls this: decode the first lines the scene says in the background.
  function prefetch(name) {
    voiceScene = name;
    sceneIds = new Set((window.AT_VOICE_SCENES && window.AT_VOICE_SCENES[name]) || []);
    prefetchScene();
  }
  async function prefetchScene() {
    if (!ctx || !voiceLoaded || !voiceScene) return;
    const gen = ++prefetchGen;
    prefetched = voiceScene;
    let ahead = 0;
    for (const id of sceneIds) {
      const V = window.AT_VOICE[id];
      if (!V || !V.a) continue;
      ahead += V.d * ctx.sampleRate * 4;
      if (ahead > VOICE_AHEAD) break;
      await voiceBuf(id);
      if (gen !== prefetchGen) return;
    }
  }

  let duckUntil = 0;
  const activeVoices = new Set();
  function stopVoice() {
    if (rec.on) return;
    voiceSeq++;
    activeVoices.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } });
    activeVoices.clear();
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* no speech */ }
    if (ctx) {
      duck.gain.cancelScheduledValues(ctx.currentTime);
      duck.gain.setTargetAtTime(1, ctx.currentTime, 0.1);
    }
  }
  function duckFor(sec) {
    if (!ctx) return;
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(duck.gain.value, t);
    duck.gain.linearRampToValueAtTime(0.35, t + 0.15);
    duck.gain.setValueAtTime(0.35, t + sec);
    duck.gain.linearRampToValueAtTime(1, t + sec + 0.4);
    duckUntil = Math.max(duckUntil, t + sec);
  }
  // Play a narration line. Returns its duration in seconds.
  function voice(id) {
    const V = window.AT_VOICE && window.AT_VOICE[id];
    const dur = V ? V.d : estimate(id);
    if (rec.on) { rec.events.push({ t: AT.engine.time, type: 'voice', id }); return dur; }
    if (!V) { speakFallback(id); return dur; }
    if (!ctx || ctx.state !== 'running') return dur;
    if (V.a) playVoice(id);
    else if (!voiceLoaded && !voiceMissing) {
      // Asked for before js/voice-data.js has arrived: play it if the audio comes
      // soon, otherwise leave just the caption (never the robot voice for this).
      const seq = voiceSeq;
      let late = false;
      vstats.waited++;
      const timer = setTimeout(() => { late = true; vstats.dropped++; }, VOICE_WAIT * 1000);
      voiceSettled.then(() => {
        if (late) return;
        clearTimeout(timer);
        if (seq !== voiceSeq || !ctx || ctx.state !== 'running') return;
        if (V.a) playVoice(id); else speakFallback(id);
      });
    } else speakFallback(id);
    return dur;
  }
  function playVoice(id) {
    const go = (buf) => {
      if (!buf) return speakFallback(id);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(voiceBus);
      s.start(ctx.currentTime + 0.02);
      activeVoices.add(s);
      s.onended = () => activeVoices.delete(s);
      duckFor(buf.duration);
      vstats.played++;
    };
    const cached = cachedVoice(id);
    if (cached) return go(cached);
    const seq = voiceSeq;
    voiceBuf(id).then((buf) => { if (seq === voiceSeq && ctx) go(buf); });
  }
  const TEXT = (id) => (window.AT_VOICE && window.AT_VOICE[id] ? window.AT_VOICE[id].t : AT.LINES && AT.LINES[id]) || '';
  const estimate = (id) => Math.max(1.2, TEXT(id).split(/\s+/).length * 0.42);
  function speakFallback(id) {
    if (muted || !('speechSynthesis' in window)) return;
    vstats.fallbacks++;
    try {
      const u = new SpeechSynthesisUtterance(TEXT(id));
      u.rate = 0.95; u.pitch = 1.15;
      speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  // ---------- page hidden ----------
  // Pause all sound while the page is hidden: the engine clock stops then too, so
  // narration stays in step with its captions, and nothing plays or schedules in the
  // background. (Not while recording or in the stepped test mode.) unlock() on the
  // next tap still resumes a context iOS has interrupted. Shares pauseSound() with
  // hold(), so a resize repaint still under way when the page comes back keeps it quiet.
  document.addEventListener('visibilitychange', () => {
    const E = AT.engine;
    if (!ctx || rec.on || !E || E.recording || E.manual) return;
    pauseSound('hidden', document.hidden);
  });

  // ---------- mute ----------
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('atticus-muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
  }

  // ---------- offline render for the cartoon videos ----------
  async function renderOffline(events, duration, sampleRate = 48000) {
    const c = new OfflineAudioContext(2, Math.ceil((duration + 0.5) * sampleRate), sampleRate);
    const b = build(c);
    const voiceTimes = [];
    // voices first, so music can be ducked under them
    for (const ev of events) {
      if (ev.type !== 'voice') continue;
      const buf = await decodeVoice(c, ev.id);
      if (!buf) continue;
      const s = c.createBufferSource();
      s.buffer = buf; s.connect(b.voiceBus); s.start(ev.t + 0.02);
      voiceTimes.push([ev.t, ev.t + buf.duration]);
    }
    b.duck.gain.setValueAtTime(1, 0);
    for (const [a, z] of voiceTimes) {
      b.duck.gain.setValueAtTime(1, Math.max(0, a - 0.01));
      b.duck.gain.linearRampToValueAtTime(0.35, a + 0.15);
      b.duck.gain.setValueAtTime(0.35, z);
      b.duck.gain.linearRampToValueAtTime(1, z + 0.4);
    }
    for (const ev of events) if (ev.type === 'sfx' && SFX[ev.name]) SFX[ev.name](c, b.sfxBus, ev.t + 0.01, ev.opts || {});
    const mus = events.filter((e) => e.type === 'music');
    for (let i = 0; i < mus.length; i++) {
      if (!mus[i].name) continue;
      const end = i + 1 < mus.length ? mus[i + 1].t : duration;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, mus[i].t);
      g.gain.exponentialRampToValueAtTime(1, mus[i].t + 0.6);
      g.gain.setValueAtTime(1, Math.max(mus[i].t + 0.6, end - 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      g.connect(b.musicBus);
      scheduleTrack(c, g, mus[i].name, mus[i].t, 0, end - mus[i].t);
    }
    const out = await c.startRendering();
    // encode 16-bit WAV, base64
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const n = out.length;
    const buf = new ArrayBuffer(44 + n * 4);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, n * 4, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      dv.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      o += 4;
    }
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  return {
    init, unlock, hold, sfx, music, stopMusic, voice, stopVoice, setMuted, renderOffline, rec,
    prefetch, loadCartoonVoices,
    // narration memory and loading counters (tests and tools/perf.mjs)
    stats() { return { ...vstats, buffers: voiceBufs.size, decodingNow: decoding.size, voiceLoaded, scene: voiceScene }; },
    get muted() { return muted; },
    get ready() { return !!ctx && ctx.state === 'running'; },
    get ctx() { return ctx; },
    resumeMusic() { if (cur && cur.pending) { const n = cur.name; cur = null; music(n); } },
  };
})();
