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
  let going = false;
  AT.sceneName = null;
  const mark = (n) => { try { performance.mark(n); } catch (e) { /* old browsers */ } };
  AT.mark = mark;
  AT.go = async (name, params = {}) => {
    if (going) return;
    going = true;
    mark(`at:go:${name}`);
    AT.audio.prefetch(name);
    if (AT.sceneName) await E.fadeTo(1, 0.35);
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
    await AT.imagesReady(E.stage, 2500);
    mark(`at:built:${name}`);
    await E.fadeTo(0, 0.45);
    mark(`at:shown:${name}`);
    going = false;
    E.spawn(() => sc.run(ctx, params));
  };

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
    const im = AT.art.img(sprite);
    im.style.left = '50%'; im.style.top = '50%';
    im.style.width = '80px'; im.style.height = '80px';
    im.style.transform = 'translate(-50%,-50%)';
    b.appendChild(im);
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); AT.audio.unlock(); AT.audio.sfx('tap'); onTap(b); });
    E.hud.appendChild(b);
    return b;
  }
  AT.buildHud = () => {
    hudButton('btn-home', 'ui_home', 24, 20, () => { if (AT.sceneName !== 'title') AT.go(AT.sceneName === 'hub' ? 'title' : 'hub'); }, 'Home');
    const snd = hudButton('btn-sound', AT.audio.muted ? 'ui_mute' : 'ui_sound', 1476, 20, (b) => {
      AT.audio.setMuted(!AT.audio.muted);
      const im = b.querySelector('img');
      im.src = AT.art.url(AT.audio.muted ? 'ui_mute' : 'ui_sound');
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
    // warm up the small sprites so they appear instantly later
    const warm = document.getElementById('warm');
    AT.art.list().filter((id) => !/^bg_|mouth_face|party_table|fg_hedge|bunting/.test(id)).forEach((id) => warm.appendChild(AT.art.img(id)));
    const bar = document.querySelector('#loading .fill');
    const imgs = [...warm.querySelectorAll('img')];
    let done = 0;
    await Promise.race([
      Promise.all(imgs.map((im) => im.decode().catch(() => {}).then(() => { done++; if (bar) bar.style.width = (done / imgs.length) * 100 + '%'; }))),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    warm.innerHTML = '';
    mark('at:warm');
    document.getElementById('loading').remove();
    AT.go(startScene && AT.scenes[startScene] ? startScene : 'title');
  };
})();
