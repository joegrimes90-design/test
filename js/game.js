/* Game glue: narration + captions, scene manager, HUD buttons, progress,
 * and the shared reward moments (stars, stickers, Mama and Dada cheering). */
(() => {
  const E = AT.engine;
  AT.scenes = AT.scenes || {};
  AT.cast = {};

  // ---------- progress ----------
  const KEY = 'atticus-progress-v1';
  const blank = () => ({ potty: false, teeth: false, baby: false, party: false, visits: 0 });
  AT.progress = blank();
  try { Object.assign(AT.progress, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage blocked */ }
  AT.save = () => { try { localStorage.setItem(KEY, JSON.stringify(AT.progress)); } catch (e) { /* storage blocked */ } };
  AT.resetProgress = () => { AT.progress = blank(); AT.save(); };
  AT.allDone = () => AT.progress.potty && AT.progress.teeth && AT.progress.baby;

  // ---------- narration ----------
  let voiceEnd = 0;
  let captionTimer = 0;
  AT.voiceBusy = () => E.time < voiceEnd;
  const NAMES = { A: 'Atticus', M: 'Mama', D: 'Dada' };
  const lineInfo = (id) => (window.AT_VOICE && window.AT_VOICE[id]) || { t: id, s: 'N', d: 1.5 };
  AT.say = async (id, who) => {
    const info = lineInfo(id);
    const dur = AT.audio.voice(id);
    voiceEnd = E.time + dur;
    showCaption(info.t, info.s);
    const speaker = who || AT.cast[info.s];
    if (speaker && speaker.talk) speaker.talk(dur);
    const myTimer = ++captionTimer;
    await E.wait(dur + 0.3);
    if (myTimer === captionTimer) hideCaption();
  };
  // say without waiting
  AT.sayNow = (id, who) => E.spawn(() => AT.say(id, who));

  function showCaption(text, s) {
    const c = E.caption;
    if (!c) return;
    c.querySelector('.who').textContent = NAMES[s] || '';
    c.querySelector('.who').style.display = NAMES[s] ? '' : 'none';
    c.querySelector('.txt').textContent = text;
    c.dataset.s = s;
    c.classList.add('show');
  }
  function hideCaption() { if (E.caption) E.caption.classList.remove('show'); }
  AT.hideCaption = hideCaption;

  // ---------- scene manager ----------
  // AT.go(name): fade to paper, build the scene behind the cover (the stage hidden: nothing
  // under the cover paints, and in live play the clock stands still), paint its sprite bitmaps
  // and every other bitmap its manifest lists (js/sprite-manifest.js: close-ups, celebrations,
  // particles, thought bubbles, so nothing is painted during play), then fade in. On a cold
  // first visit (live play, bitmaps for the first scene neither painted nor stored) the scene
  // is shown at once, still, with its plain SVG sprites and a progress pill, while the bitmaps
  // are painted; they go in all at once and then the clock starts (coldPreview). Once a scene
  // is shown, the small sprites of the scenes that can follow are painted in idle time.
  let going = false, goSeq = 0, previewing = false;
  AT.sceneName = null;
  const mark = (n) => { try { performance.mark(n); } catch (e) { /* old browsers */ } };
  AT.mark = mark;
  const live = () => !E.manual && !E.recording;
  AT.go = async (name, params = {}) => {
    if (going) return;
    going = true;
    const seq = ++goSeq;
    const first = !AT.sceneName;
    mark(`at:go:${name}`);
    AT.audio.prefetch(name);
    AT.art.play(false);
    AT.art.idlePrefetch(null); // (not while a scene is loading)
    // start painting what the scene's manifest lists now, while the last scene fades out
    const manifest = AT.art.prefetchScene(name);
    if (AT.sceneName) await E.fadeTo(1, 0.35);
    mark(`at:faded:${name}`);
    // Nothing under the cover paints while the scene is built and its sprite bitmaps
    // are painted (live SVG frames would compete with the painting for the CPU).
    E.stage.classList.add('covered');
    // all lanes behind the cover (the first scene: once it is known whether it is previewed)
    if (!first) AT.art.lanes(true);
    // Live play: the clock stands still while the scene is built and painted behind the cover.
    // (Sprites are painted off the main thread, so frames keep running meanwhile: the scene's
    // animations would otherwise run on hidden, and oscillating sprites ask for new bitmaps.)
    if (live()) E.hold('build', true);
    E.hold('preview', false); // (a cold preview still painting: this scene replaces it)
    E.newToken();
    AT.audio.stopVoice();
    voiceEnd = 0;
    hideCaption();
    E.world.innerHTML = '';
    E.ui.innerHTML = '';
    E.fxScreen.innerHTML = '';
    E.camera.set({ x: 0, y: 0, zoom: 1 });
    document.getElementById('night').style.opacity = 0;
    AT.cast = {};
    const sc = AT.scenes[name];
    AT.sceneName = name;
    document.body.dataset.scene = name;
    const ctx = sc.build(params) || {};
    mark(`at:dom:${name}`);
    // Paint the scene's sprite bitmaps, all put in at once at the end: started right away (before the
    // new imgs' own fit, which would put each in as soon as it is painted). The first scene drives the
    // loading bar or the preview's pill; the preview also waits for the manifest (scene: name).
    let progress = null;
    const bar = document.querySelector('#loading .fill');
    const painting = AT.art.fit(E.stage, { scene: first ? name : null, defer: true, onProgress: (p) => { if (progress) progress(p); } });
    if (bar) progress = (p) => { bar.style.transform = `scaleX(${p.toFixed(3)})`; };
    // bitmaps painted on an earlier visit (IndexedDB), if the browser keeps them
    await AT.art.storeReady();
    if (first && live() && AT.art.mode === 'bitmap' && !AT.art.ready(E.stage)) return coldPreview(name, sc, ctx, params, seq, painting, (f) => { progress = f; });
    AT.art.lanes(true);
    await painting;
    await AT.art.fit(E.stage);
    mark(`at:raster:${name}`);
    const loading = document.getElementById('loading');
    if (loading) loading.remove();
    await AT.imagesReady(E.stage, 10000);
    E.hold('build', false);
    E.stage.classList.remove('covered');
    mark(`at:built:${name}`);
    // the rest of the manifest (close-ups, celebrations, particles) by the time the scene plays: at
    // the latest while it fades in (nothing is painted once it plays; small ones by then, so the
    // fade's own frames still get through)
    await Promise.all([E.fadeTo(0, 0.45), ...manifest.map((m) => m[0])]);
    AT.art.lanes(false);
    mark(`at:shown:${name}`);
    if (first) mark(`at:live:${name}`);
    going = false;
    shown(name);
    E.spawn(() => sc.run(ctx, params));
  };
  // A cold first visit: the scene still, as SVG, while its bitmaps are painted. Nothing moves, so
  // the SVG is rasterised once; a tap is taken (the title's wait for it ends) and the scene goes on
  // when the clock starts.
  async function coldPreview(name, sc, ctx, params, seq, painting, onProgress) {
    previewing = true;
    E.hold('preview', true);
    E.hold('build', false);
    // the scene's plain SVG images, loaded once the first big bitmaps are being painted (the page
    // parses those SVG documents one after another, which would hold up the painting's own images)
    await AT.art.whenPainting(500);
    AT.art.showSvg(E.stage);
    // all loaded before it is shown: then it is rasterised once (an image arriving later would
    // repaint it, and that change would wait for the raster under way)
    await AT.imagesReady(E.stage, 1500);
    E.stage.classList.remove('covered');
    const loading = document.getElementById('loading');
    if (loading) loading.remove();
    const pill = progressPill();
    pill.show();
    AT.art.lanes(true); // (still: the page's own frames need little)
    // Progress shows only once the still scene is on screen: until its SVG has been rasterised
    // (a second or more), any other change to the page would wait for that, freezing the page.
    // (Its largest image being painted: largest-contentful-paint; else after 3 s.)
    let onScreen = false;
    const presented = whenPresented(3000).then(() => { onScreen = true; });
    AT.art.holdDecodes(presented); // (the same for the painted bitmaps' decodes)
    onProgress((p) => { if (onScreen) pill.set(p); });
    mark(`at:built:${name}`);
    await E.fadeTo(0, 0.45);
    mark(`at:shown:${name}`);
    const shownAt = performance.now();
    going = false;
    E.spawn(() => sc.run(ctx, params));
    const current = () => seq === goSeq;
    try {
      // every bitmap painted first (a resize meanwhile: again, for the new scale), then put in at
      // once, so the tiles showing SVG are rasterised again only once
      await painting;
      while (current() && !AT.art.ready(E.stage)) await AT.art.fit(E.stage, { scene: name, defer: true, onProgress: (p) => pill.set(p) });
      // (tests/e2e/loading.spec.mjs: a preview long enough to tap or resize during it)
      if (tun.previewMinMs > 0) await wallWait(tun.previewMinMs - (performance.now() - shownAt));
      if (current()) {
        await AT.art.fit(E.stage);
        await AT.imagesReady(E.stage, 10000);
        mark(`at:raster:${name}`);
        // the clock starts once the swapped stage is drawn and frames flow again (a slow device
        // otherwise drops frames in the scene's first half second)
        await smoothFrames(600);
      }
    } finally {
      pill.hide();
      previewing = false;
      if (current()) {
        E.hold('preview', false);
        AT.art.lanes(false);
        mark(`at:live:${name}`);
        shown(name);
      }
    }
  }
  // Resolves after three animation frames in a row at (nearly) the display rate, or after ms.
  function smoothFrames(ms) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = 0, good = 0;
      const f = (now) => {
        good = last && now - last < 20 ? good + 1 : 0;
        last = now;
        if (good >= 3 || now - t0 > ms) resolve(); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }
  // Resolves when a frame painted from now on has reached the screen (its largest image's
  // largest-contentful-paint entry), or after ms (browsers without that API).
  function whenPresented(ms) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
      try {
        const po = new PerformanceObserver((list) => {
          if (list.getEntries().some((e) => e.startTime >= t0)) { po.disconnect(); resolve(); }
        });
        po.observe({ type: 'largest-contentful-paint', buffered: false });
      } catch (e) { /* no largest-contentful-paint here */ }
    });
  }
  // after a scene has faded in: store new bitmaps (when idle), paint the next scenes' small
  // sprites in idle time, and once a session tidy the stored bitmaps
  function shown(name) {
    AT.art.play(true);
    AT.art.persist();
    AT.art.idlePrefetch(name);
    if (name === 'hub') AT.art.housekeep();
  }

  // ---------- resizes: sprite bitmaps follow the new device scale ----------
  // (E.onResized is called by the engine on resize, rotation, fullscreen and zoom.)
  // At once: every sprite gets its cached bitmap for the new scale, or its SVG where
  // the old bitmap would now be shown magnified (AT.art.resized). In live play, if any
  // had to go back to SVG, the clock pauses behind the paper cover straight away
  // (rather than show a moving stage of slow SVG sprites). After 250 ms without
  // further changes: when every bitmap is cached, they are swapped in; otherwise they
  // are painted with the clock and sound paused. The blank cover lasts at most about
  // 1 s: if painting will take longer (estimated, or it turns out to), the still scene
  // is shown first (sprites not painted yet show their SVG, which looks the same and,
  // as nothing moves, costs one raster) with a progress pill. The new bitmaps go in
  // all at once when they are all painted, and the clock starts again. Bitmaps for
  // the old scale stay cached.
  // ms of blank paper at most (unless one sprite alone takes longer); tests may lower it
  const tun = window.__AT_RASTER_TUNING || {};
  const REFIT_COVER_MAX = tun.refitCoverMs >= 0 ? tun.refitCoverMs : 1000;
  let refitTimer = 0, refitDone = null, refits = Promise.resolve(), refitCovered = false, coveredAt = 0;
  function pauseForRefit() {
    refitCovered = true;
    coveredAt = performance.now();
    mark('at:refit:cover');
    E.hold('refit', true);
    if (AT.audio.hold) AT.audio.hold(true);
  }
  E.onResized = () => {
    if (AT.art.mode !== 'bitmap') return;
    AT.art.idlePrefetch(null); // (again once the new size is painted)
    const toSvg = AT.art.resized(E.stage);
    if (!refitDone) AT.art.track(new Promise((r) => { refitDone = r; }));
    // (a cold preview repaints for the new scale by itself)
    if (toSvg && live() && AT.sceneName && !going && !refitCovered && !previewing) {
      pauseForRefit();
      E.cover(1, 0); // at once
      E.stage.classList.add('covered');
    }
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => { refits = refits.then(refitStage); }, 250);
  };
  const wallWait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 'Getting the paints ready…' pill above the stage (outside it: it never repaints the stage)
  function progressPill() {
    let el = null, fill = null, p = 0, at = 0;
    return {
      // (a few times a second at most: every change is a frame the compositor must take)
      set(v) {
        p = v;
        const now = performance.now();
        if (!fill || (now - at < 250 && p < 1)) return;
        at = now;
        fill.style.transform = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(3)})`;
      },
      show() {
        if (el) return;
        el = document.createElement('div');
        el.id = 'repaint';
        el.innerHTML = '<div>Getting the paints ready…</div><div class="bar"><div class="fill"></div></div>';
        fill = el.querySelector('.fill');
        this.set(p);
        document.body.appendChild(el);
      },
      hide() { if (el) el.remove(); el = fill = null; },
    };
  }
  async function refitStage() {
    const done = refitDone;
    refitDone = null;
    AT.art.hold(false);
    const pill = progressPill();
    try {
      if (previewing) return; // (it paints for the new scale itself)
      if (!refitCovered && (going || !live() || !AT.sceneName || AT.art.ready(E.stage))) { await AT.art.fit(E.stage); return; }
      if (!refitCovered) {
        pauseForRefit();
        await E.cover(1, 0.2);
      }
      E.stage.classList.add('covered');
      let previewed = false;
      const preview = async () => {
        previewed = true;
        mark('at:refit:preview');
        AT.art.inexactToSvg(E.stage);
        pill.show();
        E.stage.classList.remove('covered');
        await E.cover(0, 0.3);
        // let the uncovered frame reach the screen before a long paint blocks the page
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      };
      const left = () => coveredAt + REFIT_COVER_MAX - performance.now();
      // painting would outlast a short blank cover: show the still scene first (before
      // painting starts, so its fade-in is not held up by a long paint)
      if (AT.art.cost(E.stage) > left()) await preview();
      // paint them all (put in at the end, at once)
      const painting = AT.art.fit(E.stage, { defer: true, onProgress: (p) => pill.set(p) });
      if (!previewed && !(await Promise.race([painting.then(() => true), wallWait(Math.max(0, left())).then(() => false)]))) await preview();
      await painting;
      await AT.art.fit(E.stage);
      await AT.imagesReady(E.stage, 10000);
    } finally {
      pill.hide();
      if (refitCovered) {
        E.stage.classList.remove('covered');
        if (parseFloat(E.fade.style.opacity || 0) > 0) await E.cover(0, 0.3);
        refitCovered = false;
        E.hold('refit', false);
        if (AT.audio.hold) AT.audio.hold(false);
      }
      mark('at:refit');
      if (done) done();
      if (!going && AT.sceneName) AT.art.idlePrefetch(AT.sceneName);
    }
  }

  AT.imagesReady = (root, timeout = 3000) => {
    const imgs = [...root.querySelectorAll('img')];
    const all = Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
    return Promise.race([all, new Promise((r) => setTimeout(r, timeout))]);
  };

  // ---------- helpers used by scenes ----------
  AT.text = (parent, str, cls, x, y) => {
    const nd = E.node(parent, { cls: 'textnode ' + (cls || '') });
    const span = document.createElement('div');
    span.className = 'txtc';
    span.textContent = str;
    nd.el.appendChild(span);
    nd.set({ x, y });
    return nd;
  };
  // gently drift a node forever (clouds etc.)
  AT.drift = (nd, dx, period) => {
    const x0 = nd.x;
    E.every((dt, t) => nd.set({ x: x0 + Math.sin(t / period * Math.PI * 2) * dx }));
  };

  // big star that flies to a target slot in the UI
  AT.flyStar = async (from, to, scale = 1) => {
    const st = E.node(E.ui, { sprite: 'star' });
    st.set({ x: from.x, y: from.y, s: 0.2 });
    AT.audio.sfx('star');
    await st.to({ s: 2 * scale, rot: 360 }, 0.5, 'back');
    await E.wait(0.3);
    await st.to({ x: to.x, y: to.y, s: scale, rot: 720 }, 0.7, 'inOut');
    E.burst(E.ui, ['sparkle', 'star'], to.x, to.y, { n: 10, speed: 300, gravity: 200, scale: 0.4, life: 0.8 });
    AT.audio.sfx('sparkle');
    return st;
  };

  // Mama and Dada pop up from the bottom of the screen and cheer.
  AT.celebrate = async (lines = ['m_hooray', 'd_proud'], opts = {}) => {
    const quiet = !!opts.quiet;
    const mama = AT.puppet(E.ui, 'mama', { x: 230, y: 1400, s: 0.95 });
    const dada = AT.puppet(E.ui, 'dada', { x: 1370, y: 1400, s: 0.95 });
    mama.setFace({ eyes: 'happy', mouth: 'laugh' });
    dada.setFace({ eyes: 'happy', mouth: 'laugh' });
    const prev = { M: AT.cast.M, D: AT.cast.D };
    AT.cast.M = mama; AT.cast.D = dada;
    if (!quiet) {
      AT.audio.sfx('fanfare');
      AT.confetti(60);
    } else {
      mama.setFace({ eyes: 'happy', mouth: 'smile' });
      dada.setFace({ eyes: 'happy', mouth: 'smile' });
    }
    await Promise.all([mama.to({ y: 935 }, 0.6, 'back'), dada.to({ y: 935 }, 0.7, 'back')]);
    if (!quiet) { mama.setPose('cheer'); dada.setPose('cheer'); AT.audio.sfx('applause'); }
    const stopHearts = E.every((dt, t) => {
      if (Math.random() < dt * (quiet ? 1.5 : 4)) {
        const who = Math.random() < 0.5 ? mama : dada;
        const side = Math.random() < 0.5 ? -1 : 1;
        E.floatUp(E.ui, 'heart', who.x + side * (110 + Math.random() * 110), 640 + Math.random() * 120, { scale: 0.5 + Math.random() * 0.4, rise: 300 });
      }
    });
    for (const id of lines) {
      const who = id[0] === 'm' ? mama : dada;
      if (!quiet) { who.setPose('clap'); }
      await AT.say(id, who);
      if (!quiet) who.setPose('cheer');
    }
    await E.wait(0.4);
    stopHearts();
    await Promise.all([mama.to({ y: 1400 }, 0.5, 'in'), dada.to({ y: 1400 }, 0.5, 'in')]);
    mama.remove(); dada.remove();
    AT.cast.M = prev.M; AT.cast.D = prev.D;
  };

  AT.confetti = (n = 50) => {
    const sprites = ['confetti0', 'confetti1', 'confetti2', 'confetti3', 'confetti4', 'confetti5', 'star'];
    for (let i = 0; i < 3; i++) {
      E.burst(E.fxScreen, sprites, 300 + i * 500, -40, { n: Math.round(n / 3), speed: 420, angle: Math.PI / 2, spread: 2.4, gravity: 380, life: 2.6, spin: 900, scale: 1, drag: 0.99 });
    }
  };

  // A round painted close-up window in the middle of the screen.
  // Children of card.inner use stage coordinates.
  AT.card = (cx = 800, cy = 430, r = 330, bg = '#e8f6fb') => {
    const holder = E.node(E.ui, { cls: 'card' }).set({ x: cx, y: cy, s: 0.01, alpha: 0 });
    const clip = document.createElement('div');
    clip.className = 'cardclip';
    Object.assign(clip.style, { left: -r + 'px', top: -r + 'px', width: 2 * r + 'px', height: 2 * r + 'px' });
    if (bg === 'tiles') clip.classList.add('tiles'); else clip.style.background = bg;
    holder.el.appendChild(clip);
    const inner = E.node(clip).set({ x: r - cx, y: r - cy });
    return {
      holder, inner,
      async show() { AT.audio.sfx('whoosh'); await holder.to({ s: 1, alpha: 1 }, 0.45, 'back'); },
      async hide() { await holder.to({ s: 0.01, alpha: 0 }, 0.3, 'in'); holder.remove(); },
    };
  };

  // three-star progress bar used by the potty game
  AT.starBar = (n = 3) => {
    const slots = [];
    const pill = document.createElement('div');
    pill.className = 'starpill';
    Object.assign(pill.style, { left: 800 - n * 60 - 10 + 'px', width: n * 120 + 20 + 'px' });
    E.ui.appendChild(pill);
    for (let i = 0; i < n; i++) {
      const x = 800 + (i - (n - 1) / 2) * 120;
      slots.push({ x, y: 78, node: E.node(E.ui, { sprite: 'star_empty' }).set({ x, y: 78, s: 0.9 }) });
    }
    return slots;
  };

  // ---------- HUD ----------
  function hudButton(id, sprite, x, y, onTap, label) {
    const b = document.createElement('button');
    b.className = 'hudbtn';
    b.id = id;
    b.setAttribute('aria-label', label);
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    // the icon, 80 px across and centred
    const im = AT.art.img(sprite);
    if (AT.art.mode === 'svg') {
      im.style.left = '50%'; im.style.top = '50%';
      im.style.width = '80px'; im.style.height = '80px';
      im.style.transform = 'translate(-50%,-50%)';
      b.appendChild(im);
    } else {
      // a 0x0 holder at the button's centre scales the sprite's box (no percentages,
      // so AT.art can work out the icon's device scale and map its bitmap 1:1)
      const [, , bw, bh] = AT.art.box(sprite);
      const holder = document.createElement('span');
      Object.assign(holder.style, { position: 'absolute', left: '50px', top: '50px', width: '0', height: '0', transformOrigin: '0 0', transform: `scale(${80 / bw},${80 / bh})` });
      im.style.left = -bw / 2 + 'px'; im.style.top = -bh / 2 + 'px';
      holder.appendChild(im);
      b.appendChild(holder);
    }
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); AT.audio.unlock(); AT.audio.sfx('tap'); onTap(b); });
    E.hud.appendChild(b);
    return b;
  }
  AT.buildHud = () => {
    hudButton('btn-home', 'ui_home', 24, 20, () => { if (AT.sceneName !== 'title') AT.go(AT.sceneName === 'hub' ? 'title' : 'hub'); }, 'Home');
    const snd = hudButton('btn-sound', AT.audio.muted ? 'ui_mute' : 'ui_sound', 1476, 20, (b) => {
      AT.audio.setMuted(!AT.audio.muted);
      AT.art.setSprite(b.querySelector('img'), AT.audio.muted ? 'ui_mute' : 'ui_sound');
    }, 'Sound on or off');
    const root = document.documentElement;
    if (root.requestFullscreen || root.webkitRequestFullscreen) {
      hudButton('btn-full', 'ui_full', 1356, 20, () => {
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          else (root.requestFullscreen || root.webkitRequestFullscreen).call(root).catch(() => {});
        } catch (e) { /* fullscreen not allowed here */ }
      }, 'Full screen');
    }
    return snd;
  };

  // ---------- paper texture overlay ----------
  AT.paperTexture = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">
<filter id="p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 0.93  0 0 0 0 0.9  0 0 0 0 0.86  0 0 0 -1.6 1.15"/></filter>
<filter id="q" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="2" seed="9" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 0.92  0 0 0 0 0.88  0 0 0 0 0.84  0 0 0 -2.2 1.25"/></filter>
<rect width="420" height="420" fill="#fff"/><rect width="420" height="420" filter="url(#q)" opacity="0.5"/><rect width="420" height="420" filter="url(#p)" opacity="0.55"/></svg>`;
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  };

  // ---------- boot ----------
  AT.boot = async () => {
    mark('at:boot');
    // start reading the bitmaps stored on earlier visits (js/raster-cache.js) and the painting
    // self-checks right away
    AT.art.warm();
    const params = new URLSearchParams(location.search);
    const record = params.get('record');
    // ?manual=1 is the deterministic test mode (see installTestHook in engine.js)
    E.init({ record: !!record, manual: params.get('manual') === '1' });
    // developer options: ?scene=potty jumps straight to a scene, ?speed=3 runs the clock faster
    E.speed = Math.max(0.25, Math.min(8, parseFloat(params.get('speed')) || 1));
    const startScene = params.get('scene');
    document.getElementById('paper').style.backgroundImage = `url(${AT.paperTexture()})`;
    if (record) {
      document.body.classList.add('recording');
      AT.audio.rec.on = true;
      return AT.audio.loadCartoonVoices().then(() => AT.recordCartoon(record));
    }
    AT.buildHud();
    // Browsers only let sound start from these events (on touch screens pointerdown doesn't count).
    const unlock = () => AT.audio.unlock();
    ['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, true));
    // (No warm-up any more: decoding SVGs never painted them. The first scene's
    // sprite bitmaps drive the loading bar, and AT.go removes it.)
    mark('at:warm');
    AT.go(startScene && AT.scenes[startScene] ? startScene : 'title');
  };
})();
