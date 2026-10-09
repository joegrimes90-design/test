/* Brushy teeth: toothpaste, brush every tooth (and chase off the sugar bugs),
 * spit, rinse, and show off a sparkly smile. */
AT.scenes.teeth = {
  build() {
    const E = AT.engine;
    const W = E.world;
    E.camera.set({ x: 1400 });
    E.node(W, { sprite: 'bg_bathroom' });
    E.node(W, { sprite: 'towel' }).set({ x: 2850, y: 432, s: 0.9 });
    E.node(W, { sprite: 'potty' }).set({ x: 1800, y: 862, s: 0.9 });
    const sink = E.node(W, { sprite: 'sink' }).set({ x: 2560, y: 862, s: 0.95 });
    sink.hit(320, 120, 0, -300, false);
    const cup = E.node(W, { sprite: 'cup' }).set({ x: 2690, y: 590, s: 0.7 });
    E.node(W, { sprite: 'stool' }).set({ x: 2440, y: 874, s: 0.85 });
    const atticus = AT.puppet(W, 'atticus', { x: 2440, y: 820 });
    const brush = atticus.hold('toothbrush', 'armR', { rot: -90, s: 0.55 });
    const fx = E.layer(W);
    AT.cast = { A: atticus };
    return { sink, cup, atticus, brush, fx };
  },

  async run(c) {
    const E = AT.engine;
    const { atticus, sink, cup, fx } = c;
    AT.audio.music('play');
    atticus.setPose('wave');
    await AT.say('n_teeth_intro');
    atticus.setPose('idle');

    // --- toothpaste close-up ---
    const card = AT.card(800, 430, 330, '#fff3dc');
    const I = card.inner;
    E.node(I, { sprite: 'toothbrush' }).set({ x: 520, y: 500, s: 2 });
    const tube = E.node(I, { sprite: 'paste_tube' }).set({ x: 890, y: 290, s: 1.4, rot: 90 });
    tube.hit(150, 260, 0, -20, false);
    const blob = E.node(I, { sprite: 'paste_blob' }).set({ x: 890, y: 492, s: 0, sy: 1 });
    await card.show();
    await AT.say('n_paste');
    await E.waitTap(tube, { remind: 'n_paste' });
    AT.audio.sfx('squish');
    tube.to({ sy: 0.8 }, 0.15).then(() => tube.to({ sy: 1 }, 0.4, 'elastic'));
    await blob.to({ s: 1 }, 0.5, 'back');
    AT.audio.sfx('sparkle');
    await AT.say('n_paste_pea');
    await card.hide();

    // --- brushing in the big mouth view ---
    await this.brushing(c);

    // --- spit ---
    await AT.say('n_spit');
    await E.waitTap(sink, { remind: 'n_spit' });
    await this.spit(c);

    // --- rinse ---
    cup.hit(110, 140, 0, -50, false);
    await AT.say('n_rinse_cup');
    await E.waitTap(cup, { remind: 'n_rinse_cup' });
    const home = { x: cup.x, y: cup.y, rot: 0 };
    await cup.to({ x: atticus.x + 10, y: atticus.y - 190, rot: -40 }, 0.5, 'inOut');
    atticus.setFace({ mouth: 'puff' });
    AT.audio.sfx('gargle');
    await E.wait(1.2);
    await cup.to(home, 0.5, 'inOut');
    await this.spit(c);

    // --- sparkly smile ---
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    atticus.setPose('cheer');
    AT.audio.sfx('sparkle');
    const stop = E.every((dt) => {
      if (Math.random() < dt * 8) E.burst(fx, 'sparkle', atticus.x + (Math.random() - 0.5) * 120, atticus.y - 300 + (Math.random() - 0.5) * 60, { n: 1, speed: 60, gravity: 0, scale: 0.5, life: 0.7 });
    });
    await AT.say('n_sparkly');
    await AT.say('a_sparkly', atticus);
    stop();
    atticus.setPose('dance');
    await AT.celebrate(['m_teeth', 'd_teeth']);
    atticus.setPose('idle');
    await AT.say('n_teeth_done');
    AT.progress.teeth = true;
    AT.save();
    AT.go('hub', { newSticker: 'teeth' });
  },

  async spit(c) {
    const E = AT.engine;
    const { atticus, fx } = c;
    atticus.setFace({ mouth: 'o' });
    await E.tween(atticus.extra, { head: 0, bobY: 18, lean: 6 }, 0.25);
    AT.audio.sfx('spit');
    E.burst(fx, ['foam', 'bubble'], 2540, 600, { n: 8, speed: 200, angle: Math.PI / 2, spread: 2, gravity: 500, scale: 0.6, life: 0.6 });
    await E.wait(0.4);
    await E.tween(atticus.extra, { bobY: 0, lean: 0 }, 0.3);
    atticus.setFace({ mouth: 'smile' });
  },

  // the giant open mouth: teeth with dirt, sugar bugs, a big brush, and scrubAt()
  buildMouth() {
    const E = AT.engine;
    const view = E.node(E.ui);
    E.node(view, { sprite: 'mouth_face' });
    const teeth = [];
    const topY = (x) => 230 + 110 * Math.pow((x - 800) / 420, 2);
    const botY = (x) => 740 - 130 * Math.pow((x - 800) / 370, 2);
    for (let i = 0; i < 7; i++) {
      const x = 800 + (i - 3) * 108;
      const slope = (220 * (x - 800)) / (420 * 420);
      teeth.push({ x, y: topY(x) + 56, rot: (Math.atan(slope) * 180) / Math.PI, top: true });
    }
    for (let i = 0; i < 6; i++) {
      const x = 800 + (i - 2.5) * 108;
      const slope = (-260 * (x - 800)) / (370 * 370);
      teeth.push({ x, y: botY(x) - 52, rot: 180 + (Math.atan(slope) * 180) / Math.PI, top: false });
    }
    teeth.forEach((t) => {
      t.node = E.node(view, { sprite: 'tooth' }).set({ x: t.x, y: t.y, rot: t.rot, s: 1.12 });
      t.dirtNode = E.node(t.node, { sprite: 'tooth_dirt' });
      t.dirt = 1;
    });
    const bugSprites = ['bug_green', 'bug_purple', 'bug_orange'];
    [0, 3, 6, 8, 10, 12].forEach((ti, k) => {
      const t = teeth[ti];
      t.bug = E.node(view, { sprite: bugSprites[k % 3] }).set({ x: t.x, y: t.y + (t.top ? 30 : -30), s: 0.78 });
      t.bug.phase = k;
    });
    const stopBugs = E.every((dt, tt) => {
      teeth.forEach((t) => {
        if (t.bug && !t.bug.gone) t.bug.set({ rot: Math.sin(tt * 3 + t.bug.phase) * 12, sy: 1 + Math.sin(tt * 6 + t.bug.phase) * 0.06 });
      });
      if (E.rand() < dt * 0.4) AT.audio.sfx('bug');
    });
    const foamLayer = E.layer(view);
    const brush = E.node(view, { sprite: 'brush_big' }).set({ x: 1260, y: 760, rot: -10 });
    const m = { view, teeth, foamLayer, brush, stopBugs, cleaned: 0, said1: false, said2: false, sndT: 0 };
    m.scrubAt = (p, amount) => {
      for (const t of teeth) {
        if (t.dirt <= 0) continue;
        if (Math.hypot(p.x - t.x, p.y - t.y) < 78) {
          t.dirt = Math.max(0, t.dirt - amount);
          t.dirtNode.set({ alpha: t.dirt });
          if (t.dirt <= 0) {
            m.cleaned++;
            AT.audio.sfx('ding');
            E.burst(foamLayer, 'sparkle', t.x, t.y, { n: 5, speed: 160, gravity: 0, scale: 0.5, life: 0.6 });
            if (t.bug) {
              const b = t.bug;
              b.gone = true;
              AT.audio.sfx('wheee');
              b.to({ x: b.x + (b.x < 800 ? -500 : 500), y: -150, rot: b.x < 800 ? -360 : 360, s: 0.4 }, 1.2, 'in').then(() => b.remove());
            }
          }
        }
      }
      if (E.rand() < 0.3) {
        const f = E.node(foamLayer, { sprite: E.rand() < 0.5 ? 'foam' : 'bubble' }).set({ x: p.x + (E.rand() - 0.5) * 60, y: p.y + (E.rand() - 0.5) * 40, s: 0.4 + E.rand() * 0.5, alpha: 0.9 });
        f.to({ alpha: 0, s: f.s * 1.3 }, 1.6 + E.rand(), 'in').then(() => f.remove());
      }
      if (E.time > m.sndT) { AT.audio.sfx('scrub'); m.sndT = E.time + 0.09; }
      if (!E.recording) {
        if (!m.said1 && m.cleaned >= 5) { m.said1 = true; AT.sayNow('n_brush_keep'); }
        if (!m.said2 && m.cleaned >= 11) { m.said2 = true; AT.sayNow('n_brush_almost'); }
      }
    };
    m.sparkleAll = () => {
      AT.audio.sfx('sparkle');
      teeth.forEach((t, i) => E.spawn(async () => { await E.wait(i * 0.05); E.burst(foamLayer, 'sparkle', t.x, t.y, { n: 3, speed: 120, gravity: 0, scale: 0.6, life: 0.8 }); }));
    };
    return m;
  },

  // interactive brushing
  async brushing(c) {
    const E = AT.engine;
    await E.fadeTo(1, 0.3);
    // as in AT.go: nothing under the cover paints while the close-up's bitmaps are painted
    E.stage.classList.add('covered');
    const m = this.buildMouth();
    const { view, teeth, brush } = m;
    const scrubAt = m.scrubAt;
    await AT.art.fit(view.el);
    await AT.imagesReady(view.el, 1500);
    E.stage.classList.remove('covered');
    await E.fadeTo(0, 0.3);
    AT.cast.A && AT.cast.A.setFace({ mouth: 'ahh' });
    await AT.say('n_open_wide');
    await AT.say('a_ahh');
    await AT.say('n_sugar_bugs');
    AT.audio.music('brush');
    AT.sayNow('n_brush_how');

    let last = null;
    let down = false;
    const move = (ev) => {
      const p = E.toStage(ev);
      brush.set({ x: p.x, y: p.y + 42, rot: -10 + Math.sin(E.time * 30) * 4 });
      if (ev.pointerType !== 'mouse' && !down) { last = p; return; }
      if (last) {
        const d = Math.hypot(p.x - last.x, p.y - last.y);
        if (d > 1) scrubAt(p, d * 0.0045);
      }
      last = p;
      E.lastInput = E.time;
    };
    const dn = (ev) => { down = true; last = E.toStage(ev); move(ev); scrubAt(last, 0.2); };
    const up = () => { down = false; last = null; };
    const st = E.stage;
    st.addEventListener('pointermove', move);
    st.addEventListener('pointerdown', dn);
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    E.onEnd(cleanup);
    function cleanup() {
      st.removeEventListener('pointermove', move);
      st.removeEventListener('pointerdown', dn);
      st.removeEventListener('pointerup', up);
      st.removeEventListener('pointercancel', up);
    }
    // gentle help for little hands
    let hand = null;
    let idleFrom = E.time;
    let hints = 0;
    while (m.cleaned < teeth.length) {
      await E.wait(0.25);
      if (!hand && E.time - Math.max(idleFrom, E.lastInput) > 6) {
        const t = teeth.find((tt) => tt.dirt > 0);
        if (t) {
          hand = E.node(view, { sprite: 'hand' });
          const t0 = E.time;
          hand.stop = E.every(() => hand.set({ x: t.x + Math.sin((E.time - t0) * 6) * 60, y: t.y + 30 }));
          if (hints++ < 3) AT.sayNow('n_brush_how');
        }
        idleFrom = E.time;
      }
      if (hand && E.time - E.lastInput < 0.3) { hand.stop(); hand.remove(); hand = null; idleFrom = E.time; }
    }
    if (hand) { hand.stop(); hand.remove(); }
    cleanup();
    m.stopBugs();
    AT.audio.music('play');
    m.sparkleAll();
    await E.wait(1.4);
    await E.fadeTo(1, 0.3);
    view.remove();
    AT.cast.A && AT.cast.A.setFace({ mouth: 'grin' });
    await E.fadeTo(0, 0.3);
  },
};
