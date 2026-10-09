/* Tiny game engine: a scaled 1600x900 stage, an engine clock, tweens,
 * cancellable async scripts, positioned nodes, particles and tap/rub input.
 *
 * Everything that moves is driven by AT.engine.time (never CSS animations),
 * so a cartoon can be stepped frame by frame and recorded to video.
 */
AT.engine = (() => {
  const W = 1600, H = 900;
  const CANCEL = { cancelled: true };
  const E = {
    W, H, CANCEL, time: 0, scale: 1, recording: false, speed: 1,
    stage: null, world: null, ui: null, hud: null,
  };

  // ---------- clock + tasks ----------
  const timers = [];          // {t, resolve, reject, token}
  const updaters = [];        // {fn, token}
  let token = { alive: true, id: 0 };
  E.token = () => token;
  E.newToken = () => {
    token.alive = false;
    (token.cleanups || []).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].token === token) { timers[i].reject(CANCEL); timers.splice(i, 1); }
    }
    for (let i = updaters.length - 1; i >= 0; i--) if (updaters[i].token === token) updaters.splice(i, 1);
    token = { alive: true, id: token.id + 1 };
    return token;
  };
  // run fn when the current scene ends (remove listeners etc.)
  E.onEnd = (fn) => { (token.cleanups = token.cleanups || []).push(fn); };
  E.wait = (sec) => new Promise((resolve, reject) => {
    const tk = token;
    if (!tk.alive) return reject(CANCEL);
    timers.push({ t: E.time + Math.max(0, sec), resolve, reject, token: tk });
  });
  // Resolve when cond() becomes true (checked every frame)
  E.until = (cond) => new Promise((resolve, reject) => {
    const tk = token;
    if (!tk.alive) return reject(CANCEL);
    if (cond()) return resolve();
    const u = { token: tk, fn: () => { if (cond()) { remove(u); resolve(); } } };
    u.reject = reject;
    updaters.push(u);
  });
  const remove = (u) => { u.dead = true; const i = updaters.indexOf(u); if (i >= 0) updaters.splice(i, 1); };
  // Run fn(dt, t) every frame until the scene ends or the returned stop() is called.
  E.every = (fn) => {
    const u = { token, fn };
    updaters.push(u);
    return () => remove(u);
  };
  E.guard = (p) => p.catch((e) => { if (e !== CANCEL) console.error(e); });
  // fire-and-forget a script that belongs to the current scene
  E.spawn = (fn) => E.guard(Promise.resolve().then(fn));

  function tick(dt) {
    E.time += dt;
    // iterate over a copy: callbacks may add or remove updaters
    const list = updaters.slice();
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.token.alive && !u.dead) u.fn(dt, E.time);
    }
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].t <= E.time + 1e-9) { const tm = timers[i]; timers.splice(i, 1); tm.resolve(); }
    }
  }
  E.dueTimers = () => timers.some((tm) => tm.t <= E.time + 1e-9);

  let last = 0;
  function frame(now) {
    if (!E.recording && !E.manual) requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    tick(dt * E.speed);
  }
  // Deterministic stepping for the video recorder.
  E.step = async (dt) => {
    tick(dt);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (!E.dueTimers()) break;
      tick(0);
    }
  };

  // ---------- easing + tweens ----------
  const ease = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
    back: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    bounce: (t) => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
    elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  };
  E.ease = ease;
  E.tween = (target, to, dur = 0.5, easing = 'inOut', onUpdate) => new Promise((resolve, reject) => {
    const tk = token;
    if (!tk.alive) return reject(CANCEL);
    const from = {};
    for (const k in to) from[k] = target[k] == null ? 0 : target[k];
    const fn = typeof easing === 'function' ? easing : ease[easing] || ease.inOut;
    const start = E.time;
    const apply = (p) => {
      const v = fn(p);
      const vals = {};
      for (const k in to) vals[k] = from[k] + (to[k] - from[k]) * v;
      if (target.set) target.set(vals); else Object.assign(target, vals);
      if (onUpdate) onUpdate(p);
    };
    if (dur <= 0) { apply(1); return resolve(); }
    const u = {
      token: tk,
      fn: () => {
        const p = Math.min(1, (E.time - start) / dur);
        apply(p);
        if (p >= 1) { remove(u); resolve(); }
      },
    };
    updaters.push(u);
  });

  // ---------- nodes ----------
  class Node {
    constructor(parent, opts = {}) {
      this.el = document.createElement('div');
      this.el.className = 'node' + (opts.cls ? ' ' + opts.cls : '');
      this.x = 0; this.y = 0; this.rot = 0; this.sx = 1; this.sy = 1; this.alpha = 1; this.s = 1;
      this.visible = true;
      if (opts.sprite) this.img = this.add(opts.sprite);
      if (parent) (parent.el || parent).appendChild(this.el);
      this.set(opts);
    }
    set(p) {
      for (const k in p) if (k in this && k !== 'el') this[k] = p[k];
      const sx = this.sx * this.s, sy = this.sy * this.s;
      this.el.style.transform = `translate(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px) rotate(${this.rot.toFixed(2)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
      this.el.style.opacity = this.alpha;
      this.el.style.display = this.visible ? '' : 'none';
      return this;
    }
    add(spriteId, cls) {
      const im = AT.art.img(spriteId, cls);
      this.el.appendChild(im);
      return im;
    }
    swap(spriteId) {
      if (!this.img) this.img = this.add(spriteId);
      else if (this.img.dataset.sprite !== spriteId) {
        const n = AT.art.img(spriteId);
        this.el.replaceChild(n, this.img);
        this.img = n;
      }
      return this;
    }
    show() { return this.set({ visible: true }); }
    hide() { return this.set({ visible: false }); }
    remove() { this.el.remove(); }
    to(props, dur, easing) { return E.tween(this, props, dur, easing); }
    // hit area for taps, in local coordinates
    hit(w, h, dx = 0, dy = 0, round = true) {
      if (!this.hitEl) {
        this.hitEl = document.createElement('div');
        this.hitEl.className = 'hit';
        this.el.appendChild(this.hitEl);
      }
      Object.assign(this.hitEl.style, {
        left: dx - w / 2 + 'px', top: dy - h / 2 + 'px', width: w + 'px', height: h + 'px',
        borderRadius: round ? '50%' : '24px',
      });
      return this;
    }
    // stage-space position of a local point
    stagePos(lx = 0, ly = 0) {
      const r = this.el.getBoundingClientRect();
      const sr = E.stage.getBoundingClientRect();
      return { x: (r.left - sr.left) / E.scale + lx * this.s, y: (r.top - sr.top) / E.scale + ly * this.s };
    }
  }
  E.Node = Node;
  E.node = (parent, opts) => new Node(parent, opts);
  E.layer = (parent, cls) => new Node(parent, { cls: 'layer ' + (cls || '') });

  // ---------- camera ----------
  E.camera = {
    x: 0, y: 0, zoom: 1,
    set(p) {
      Object.assign(this, p);
      E.world.style.transform = `scale(${this.zoom}) translate(${-this.x}px,${-this.y}px)`;
      return this;
    },
  };

  // ---------- stage + scaling ----------
  E.init = (opts = {}) => {
    E.recording = !!opts.record;
    E.manual = !!opts.manual;
    E.stage = document.getElementById('stage');
    E.world = document.getElementById('world');
    E.fxScreen = document.getElementById('fxs');
    E.ui = document.getElementById('ui');
    E.hud = document.getElementById('hud');
    E.caption = document.getElementById('caption');
    E.fade = document.getElementById('fade');
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      E.scale = Math.min(vw / W, vh / H);
      E.stage.style.transform = `translate(${(vw - W * E.scale) / 2}px,${(vh - H * E.scale) / 2}px) scale(${E.scale})`;
    };
    window.addEventListener('resize', fit);
    fit();
    E.camera.set({ x: 0, y: 0, zoom: 1 });
    if (E.manual) installTestHook();
    else if (!E.recording) requestAnimationFrame(frame);
  };

  // ---------- test hook (?manual=1, used by tests/ only) ----------
  // The clock stands still until a test calls `await __test.step(seconds, fps)`,
  // which advances it in fixed 1/fps steps through E.step(). Before each step it
  // waits for pending image decodes, so slow decoding never shifts the timeline.
  // With Math.random seeded by the test, every frame is reproducible.
  function installTestHook() {
    const ch = new MessageChannel();
    const yieldTask = () => new Promise((r) => { ch.port1.onmessage = r; ch.port2.postMessage(0); });
    const settle = () => Promise.all([...E.stage.querySelectorAll('img')].map((im) => im.decode().catch(() => {}))).then(yieldTask);
    window.__test = {
      async step(sec = 0, fps = 60) {
        const n = Math.max(1, Math.round(sec * fps));
        for (let i = 0; i < n; i++) { await settle(); await E.step(sec / n); }
        return E.time;
      },
      get time() { return E.time; },
    };
  }

  // pointer -> stage coordinates
  E.toStage = (ev) => {
    const r = E.stage.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / E.scale, y: (ev.clientY - r.top) / E.scale };
  };
  E.toWorld = (p) => ({ x: p.x / E.camera.zoom + E.camera.x, y: p.y / E.camera.zoom + E.camera.y });

  // ---------- input ----------
  E.lastInput = 0;
  const markInput = () => { E.lastInput = E.time; };
  document.addEventListener('pointerdown', markInput, true);

  // Call fn whenever node is tapped (until the scene ends). Returns off().
  E.onTap = (node, fn, opts = {}) => {
    if (!node.hitEl) {
      const box = node.img ? AT.art.box(node.img.dataset.sprite) : [-80, -80, 160, 160];
      node.hit(box[2] * (opts.pad || 1), box[3] * (opts.pad || 1), box[0] + box[2] / 2, box[1] + box[3] / 2, false);
    }
    const tk = token;
    const el = node.hitEl;
    const h = (ev) => {
      if (!tk.alive || E.locked) return;
      ev.preventDefault();
      ev.stopPropagation();
      fn(ev);
    };
    const evName = opts.event || 'pointerdown';
    el.addEventListener(evName, h);
    el.classList.add('on');
    const off = () => { el.removeEventListener(evName, h); el.classList.remove('on'); };
    return off;
  };

  // Wait for a tap on one of several nodes; resolves with the index tapped.
  // While waiting they glow; after a pause a hand points at opts.hint and
  // opts.remind is said again (up to three times).
  E.choose = (nodes, opts = {}) => new Promise((resolve, reject) => {
    const tk = token;
    if (!tk.alive) return reject(CANCEL);
    let done = false;
    let hint = null;
    let idleFrom = E.time;
    let reminders = 0;
    const offs = nodes.map((n, i) => E.onTap(n, () => { AT.audio.sfx('tap'); finish(i); }, opts));
    const glows = opts.glow === false ? [] : nodes.map((n) => E.glow(n));
    const finish = (i) => {
      if (done) return;
      done = true;
      offs.forEach((f) => f());
      glows.forEach((g) => g());
      stopIdle();
      if (hint) hint.remove();
      resolve(i);
    };
    const delay = opts.hintAfter || 6;
    const stopIdle = E.every(() => {
      if (E.time - Math.max(idleFrom, E.lastInput) > delay && !AT.voiceBusy()) {
        idleFrom = E.time;
        if (!hint && opts.hint !== null) hint = E.pointAt(nodes[opts.hint || 0], opts.handOffset);
        if (opts.remind && reminders < 3) { reminders++; AT.sayNow(opts.remind); }
      }
    });
    if (opts.hintNow) hint = E.pointAt(nodes[opts.hint || 0], opts.handOffset);
  });
  E.waitTap = (node, opts = {}) => E.choose([node], opts);

  // Gentle pulsing highlight under a node. Returns stop().
  E.glow = (node) => {
    const g = document.createElement('div');
    g.className = 'glowring';
    const hb = node.hitEl;
    if (hb) {
      g.style.left = hb.style.left; g.style.top = hb.style.top;
      g.style.width = hb.style.width; g.style.height = hb.style.height;
      g.style.borderRadius = hb.style.borderRadius;
    }
    node.el.insertBefore(g, node.el.firstChild);
    const stop = E.every((dt, t) => {
      const k = 0.5 + 0.5 * Math.sin(t * 5);
      g.style.opacity = (0.35 + 0.5 * k).toFixed(3);
      g.style.transform = `scale(${(1 + 0.06 * k).toFixed(3)})`;
    });
    return () => { stop(); g.remove(); };
  };

  // Bouncing hand pointing at a node (in the node's layer). Returns the hand node.
  E.pointAt = (node, off = {}) => {
    const hb = node.hitEl;
    const cx = hb ? parseFloat(hb.style.left) + parseFloat(hb.style.width) / 2 : 0;
    const cy = hb ? parseFloat(hb.style.top) + parseFloat(hb.style.height) / 2 : 0;
    const hand = new Node(node.el.parentNode, { sprite: 'hand', cls: 'hint' });
    const bx = node.x + (cx + (off.x || 0)) * node.s * node.sx;
    const by = node.y + (cy + (off.y || 20)) * node.s * node.sy;
    hand.set({ x: bx, y: by, s: 1.1 });
    const stop = E.every((dt, t) => hand.set({ y: by + Math.abs(Math.sin(t * 4)) * 26 }));
    const rm = hand.remove.bind(hand);
    hand.remove = () => { stop(); rm(); };
    return hand;
  };

  // Track rubbing/scrubbing movement over a node's hit area.
  // fn(distance, stagePoint) is called while a finger (or mouse) moves over it.
  E.onRub = (node, fn) => {
    const tk = token;
    let lastP = null;
    let down = false;
    const el = node.hitEl;
    el.classList.add('on');
    const move = (ev) => {
      if (!tk.alive) return;
      const p = E.toStage(ev);
      const isMouse = ev.pointerType === 'mouse';
      if (!down && !isMouse) { lastP = null; return; }
      if (lastP) {
        const d = Math.hypot(p.x - lastP.x, p.y - lastP.y);
        if (d > 0.5) fn(d, p, ev);
      }
      lastP = p;
      markInput();
    };
    const dn = (ev) => { down = true; lastP = E.toStage(ev); ev.preventDefault(); try { el.setPointerCapture(ev.pointerId); } catch (e) { /* not needed */ } };
    const up = () => { down = false; lastP = null; };
    el.addEventListener('pointerdown', dn);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return () => {
      el.removeEventListener('pointerdown', dn);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
      el.classList.remove('on');
    };
  };

  // ---------- particles ----------
  // burst(layer, sprite(s), x, y, {n, speed, up, gravity, life, spin, scale})
  E.burst = (layer, sprites, x, y, o = {}) => {
    const n = o.n || 10;
    const list = Array.isArray(sprites) ? sprites : [sprites];
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * Math.PI * 2;
      const sp = (o.speed || 400) * (0.5 + Math.random() * 0.7);
      const nd = new Node(layer, { sprite: list[i % list.length], cls: 'fx' });
      const sc = (o.scale || 1) * (0.6 + Math.random() * 0.6);
      parts.push({ nd, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), r: Math.random() * 360, vr: (Math.random() - 0.5) * (o.spin || 400), sc, life: (o.life || 1.2) * (0.7 + Math.random() * 0.6), age: 0 });
    }
    const g = o.gravity == null ? 600 : o.gravity;
    const stop = E.every((dt) => {
      let alive = 0;
      for (const p of parts) {
        if (p.age > p.life) continue;
        p.age += dt;
        p.vy += g * dt;
        p.vx *= o.drag || 1;
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        const k = p.age / p.life;
        const grow = o.grow ? 0.4 + 0.6 * Math.min(1, k * 4) : 1;
        p.nd.set({ x: p.x, y: p.y, rot: p.r, s: p.sc * grow, alpha: k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1 });
        if (p.age > p.life) p.nd.remove(); else alive++;
      }
      if (!alive) stop();
    });
  };
  // a few floating things that drift upwards (hearts, notes, bubbles)
  E.floatUp = (layer, sprite, x, y, o = {}) => {
    const nd = new Node(layer, { sprite, cls: 'fx' });
    const life = o.life || 2;
    const t0 = E.time;
    const sway = (Math.random() - 0.5) * 2;
    const s0 = o.scale || 1;
    const stop = E.every(() => {
      const k = (E.time - t0) / life;
      if (k >= 1) { nd.remove(); stop(); return; }
      nd.set({ x: x + Math.sin(k * 6 + sway * 3) * 30 * (o.wobble || 1), y: y - k * (o.rise || 220), s: s0 * (0.5 + Math.min(1, k * 5) * 0.5), alpha: k > 0.6 ? (1 - k) / 0.4 : 1, rot: Math.sin(k * 5) * 10 });
    });
    return nd;
  };

  // ---------- screen transitions ----------
  E.fadeTo = (opacity, dur = 0.45) => {
    const st = { v: parseFloat(E.fade.style.opacity || 0) };
    E.fade.style.pointerEvents = opacity > 0 ? 'auto' : 'none';
    return new Promise((resolve) => {
      const start = E.time;
      const from = st.v;
      const u = {
        token: { alive: true },
        fn: () => {
          const p = Math.min(1, (E.time - start) / dur);
          E.fade.style.opacity = (from + (opacity - from) * ease.inOut(p)).toFixed(3);
          if (p >= 1) { remove(u); resolve(); }
        },
      };
      updaters.push(u);
    });
  };

  // random helpers that stay deterministic in recording mode
  let seed = 12345;
  E.rand = () => (E.recording ? ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) : Math.random());
  E.pick = (arr) => arr[Math.floor(E.rand() * arr.length)];

  return E;
})();
