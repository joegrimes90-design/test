/* Cartoons: short scripted films using the game's own scenes and puppets.
 * tools/render-videos.mjs opens index.html?record=<name>, steps the engine
 * frame by frame, screenshots each frame and mixes the soundtrack offline. */
AT.cartoons = {
  potty: {
    build() {
      const c = AT.scenes.potty.build();
      c.stars.forEach((s) => s.node.hide());
      AT.engine.ui.querySelectorAll('.starpill').forEach((el) => el.remove());
      return c;
    },
    async run(c) {
      const E = AT.engine;
      const { atticus, toys, strip, swirl, fx, wiggle, glow, towel } = c;
      AT.audio.music('play');
      await E.wait(0.8);
      const play = E.every((dt, t) => { atticus.extra.head = Math.sin(t * 2) * 6; });
      AT.audio.sfx('block');
      await toys.c.to({ y: 700 }, 0.3, 'out');
      await toys.c.to({ y: 755 }, 0.3, 'bounce');
      AT.audio.sfx('block');
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await AT.say('c_p1');
      play();
      atticus.extra.head = 0;
      // the feeling
      atticus.setFace({ eyes: 'wide', mouth: 'o' });
      AT.audio.sfx('boing');
      await E.wait(0.5);
      atticus.setPose('wiggle');
      atticus.setFace({ eyes: 'worry', mouth: 'wobble' });
      glow.set({ x: atticus.x, y: atticus.y - 140 });
      const fxStop = E.every((dt, t) => {
        wiggle.set({ alpha: 0.6 + 0.4 * Math.sin(t * 10), s: 1 + 0.08 * Math.sin(t * 7) });
        glow.set({ x: atticus.x, alpha: 0.55 + 0.35 * Math.sin(t * 5), s: 1.3 + 0.15 * Math.sin(t * 5) });
      });
      AT.audio.sfx('wiggle');
      await AT.say('c_p2');
      AT.audio.sfx('wiggle');
      await AT.say('c_p3');
      await AT.say('a_need_wee', atticus);
      fxStop();
      wiggle.set({ alpha: 0 }); glow.set({ alpha: 0 });
      AT.sayNow('c_p4');
      atticus.setPose('run');
      await Promise.all([atticus.to({ x: 1900 }, 2.6, 'inOut'), E.tween(E.camera, { x: 1400 }, 2.6, 'inOut')]);
      atticus.setPose('tummy');
      await E.wait(0.6);
      // pants down, sit
      AT.sayNow('c_p5');
      AT.audio.sfx('fwip');
      await E.tween(atticus.parts.shorts, { y: -40 }, 0.22, 'in');
      atticus.parts.shorts.set({ y: -80 });
      atticus.pantsDown = true;
      await E.wait(0.9);
      AT.audio.sfx('boing');
      E.spawn(async () => { await E.wait(0.2); atticus.setPose('sit'); atticus.pantsDown = false; });
      await atticus.jump(55, 0.42);
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
      await E.wait(1);
      // wee
      atticus.setFace({ eyes: 'happy', mouth: 'smile' });
      AT.audio.sfx('tinkle');
      const sp = E.every(() => { if (E.rand() < 0.25) E.floatUp(fx, E.rand() < 0.5 ? 'sparkle' : 'bubble', 1830 + E.rand() * 140, 770, { scale: 0.35 + E.rand() * 0.3, rise: 160, life: 1.2 }); });
      await AT.say('c_p6');
      sp();
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      // wipe, pants up, flush
      AT.sayNow('c_p7');
      AT.audio.sfx('paper');
      await strip.to({ sy: 1 }, 0.5, 'out');
      await strip.to({ x: atticus.x + 80, y: atticus.y - 140, s: 0.3, alpha: 0 }, 0.4, 'in');
      AT.audio.sfx('fwip', { up: true });
      atticus.setPose('idle');
      await atticus.jump(40, 0.35);
      await atticus.walkTo(1735, 300);
      AT.audio.sfx('flush');
      swirl.set({ alpha: 1 });
      const t0 = E.time;
      const sw = E.every(() => {
        const k = (E.time - t0) / 2;
        swirl.set({ sx: Math.cos((E.time - t0) * 14) * (1 - k * 0.6), alpha: k < 0.8 ? 1 : Math.max(0, (1 - k) * 5) });
      });
      atticus.setPose('wave');
      await E.wait(2);
      sw(); swirl.set({ alpha: 0 });
      atticus.setPose('idle');
      // wash hands
      await atticus.walkTo(2560, 320);
      E.spawn(() => atticus.jump(50, 0.35));
      await atticus.to({ y: 820 }, 0.35, 'out');
      const card = AT.card(800, 430, 330, 'tiles');
      const I = card.inner;
      E.node(I, { sprite: 'sink' }).set({ x: 760, y: 1280, s: 2.6 });
      const hands = E.node(I, { sprite: 'hands' }).set({ x: 880, y: 655, s: 1.05 });
      const water = E.node(I, { sprite: 'water' }).set({ x: 890, y: 422, s: 2.4, sy: 0 });
      const soap = E.node(I, { sprite: 'soap' }).set({ x: 1040, y: 515, s: 1.6 });
      await card.show();
      AT.sayNow('c_p8');
      AT.audio.sfx('water', { dur: 4.5 });
      await water.to({ sy: 1 }, 0.3, 'out');
      AT.audio.sfx('squish');
      await soap.to({ sy: 0.85 }, 0.15);
      await soap.to({ sy: 1 }, 0.3, 'elastic');
      const hs = E.time;
      const rub = E.every((dt, t) => {
        hands.set({ rot: Math.sin(t * 30) * 6, x: 880 + Math.sin(t * 25) * 10 });
        if (E.rand() < 0.35) {
          const b = E.node(I, { sprite: E.rand() < 0.6 ? 'bubble' : 'foam' }).set({ x: 820 + E.rand() * 120, y: 550 + E.rand() * 120, s: 0.3 + E.rand() * 0.6 });
          b.to({ y: b.y - 60, alpha: 0 }, 1.2, 'out').then(() => b.remove());
        }
        if (E.time - hs > 0.15 && Math.floor(t * 8) % 2 === 0 && E.rand() < 0.2) AT.audio.sfx('scrub');
      });
      await E.wait(3.2);
      rub();
      hands.set({ rot: 0, x: 880 });
      await water.to({ sy: 0 }, 0.25, 'in');
      await card.hide();
      E.spawn(() => atticus.jump(40, 0.3));
      await atticus.to({ y: 862 }, 0.3, 'in');
      await atticus.walkTo(2790, 320);
      AT.audio.sfx('swish');
      const tw = E.time;
      await E.until(() => { towel.set({ rot: Math.sin((E.time - tw) * 18) * 6 }); return E.time - tw > 1; });
      towel.set({ rot: 0 });
      await atticus.walkTo(2300, 340);
      // hooray
      atticus.setPose('dance');
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      AT.audio.sfx('sparkle');
      await AT.say('c_p9');
      await AT.celebrate(['m_hooray', 'd_proud']);
      atticus.setPose('wave');
      await AT.say('c_p10');
      await E.wait(1.2);
    },
  },

  teeth: {
    build() { return AT.scenes.teeth.build(); },
    async run(c) {
      const E = AT.engine;
      const T = AT.scenes.teeth;
      const { atticus, cup } = c;
      AT.audio.music('play');
      await E.wait(0.6);
      atticus.setPose('wave');
      await AT.say('c_t1');
      atticus.setPose('idle');
      const card = AT.card(800, 430, 330, '#fff3dc');
      const I = card.inner;
      E.node(I, { sprite: 'toothbrush' }).set({ x: 520, y: 500, s: 2 });
      const tube = E.node(I, { sprite: 'paste_tube' }).set({ x: 890, y: 290, s: 1.4, rot: 90 });
      const blob = E.node(I, { sprite: 'paste_blob' }).set({ x: 890, y: 492, s: 0 });
      await card.show();
      AT.sayNow('c_t2');
      await E.wait(0.6);
      AT.audio.sfx('squish');
      tube.to({ sy: 0.8 }, 0.15).then(() => tube.to({ sy: 1 }, 0.4, 'elastic'));
      await blob.to({ s: 1 }, 0.5, 'back');
      await E.wait(1.6);
      await card.hide();
      // brushing
      await E.fadeTo(1, 0.3);
      const m = T.buildMouth();
      await AT.imagesReady(m.view.el, 3000);
      await E.fadeTo(0, 0.3);
      AT.audio.music('brush');
      AT.sayNow('c_t3');
      const brushPath = async (teeth) => {
        for (const t of teeth) {
          const t0 = E.time;
          await E.until(() => {
            const k = E.time - t0;
            const p = { x: t.x + Math.sin(k * 22) * 34, y: t.y + Math.cos(k * 15) * 14 };
            m.brush.set({ x: p.x, y: p.y + 42, rot: -10 + Math.sin(k * 30) * 4 });
            m.scrubAt(p, 0.06);
            return t.dirt <= 0;
          });
        }
      };
      await brushPath(m.teeth.filter((t) => t.top));
      await brushPath(m.teeth.filter((t) => !t.top).reverse());
      m.stopBugs();
      AT.audio.music('play');
      await AT.say('c_t4');
      m.sparkleAll();
      await E.wait(1);
      await E.fadeTo(1, 0.3);
      m.view.remove();
      await E.fadeTo(0, 0.3);
      AT.sayNow('c_t5');
      await E.wait(0.6);
      await T.spit(c);
      const home = { x: cup.x, y: cup.y, rot: 0 };
      await cup.to({ x: atticus.x + 10, y: atticus.y - 190, rot: -40 }, 0.5, 'inOut');
      AT.audio.sfx('gargle');
      await E.wait(1.1);
      await cup.to(home, 0.5, 'inOut');
      await T.spit(c);
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      atticus.setPose('cheer');
      AT.audio.sfx('sparkle');
      const st = E.every(() => {
        if (E.rand() < 0.15) E.burst(c.fx, 'sparkle', atticus.x + (E.rand() - 0.5) * 120, atticus.y - 300 + (E.rand() - 0.5) * 60, { n: 1, speed: 60, gravity: 0, scale: 0.5, life: 0.7 });
      });
      await AT.say('c_t6');
      st();
      atticus.setPose('dance');
      await AT.celebrate(['m_teeth', 'd_teeth']);
      atticus.setPose('wave');
      await E.wait(1.5);
    },
  },

  baby: {
    build() { return AT.scenes.baby.build(); },
    async run(c) {
      const E = AT.engine;
      const B = AT.scenes.baby;
      const { baby, atticus, items } = c;
      AT.audio.music('play');
      baby.setFace({ eyes: 'happy', mouth: 'giggle' });
      baby.setPose('happy');
      atticus.setPose('wave');
      AT.audio.sfx('giggle');
      B.hearts(c, 5);
      await AT.say('c_b1');
      atticus.setPose('idle');
      baby.setPose('cry');
      baby.setFace({ eyes: 'cry', mouth: 'cry', tears: 'on' });
      AT.audio.sfx('cry');
      AT.sayNow('c_b2');
      await E.wait(1.6);
      await items.teddy.to({ x: 800, y: 845, s: 0.55, rot: -8 }, 0.8, 'inOut');
      baby.setPose('happy');
      baby.setFace({ eyes: 'happy', mouth: 'giggle', tears: null });
      AT.audio.sfx('giggle');
      B.hearts(c, 5);
      await E.wait(1.8);
      await items.teddy.to({ x: 560, y: 850, rot: 0 }, 0.5, 'inOut');
      baby.setPose('idle');
      baby.setFace({ eyes: 'open', mouth: 'o' });
      AT.sayNow('c_b3');
      await E.wait(1);
      await items.bottle.to({ x: 794, y: 557, s: 0.7, rot: -135 }, 0.7, 'inOut');
      baby.setPose('eat');
      baby.setFace({ eyes: 'happy', mouth: 'o' });
      AT.audio.sfx('gulp');
      await E.wait(1.8);
      await items.bottle.to({ x: 1465, y: 1100, alpha: 0 }, 0.6, 'in');
      baby.setPose('idle');
      baby.setFace({ eyes: 'open', mouth: 'smile' });
      AT.sayNow('c_b4');
      for (let i = 0; i < 2; i++) {
        atticus.armsFront(true);
        atticus.setPose('peek');
        baby.setFace({ eyes: 'open', mouth: 'o' });
        if (i === 1) AT.sayNow('a_peekaboo', atticus);
        await E.wait(0.85);
        atticus.setPose('cheer');
        atticus.setFace({ eyes: 'wide', mouth: 'grin' });
        AT.audio.sfx('peek');
        await E.wait(0.15);
        baby.setFace({ eyes: 'happy', mouth: 'giggle' });
        baby.setPose('happy');
        AT.audio.sfx('giggle');
        B.hearts(c, 3);
        await E.wait(1.1);
        atticus.armsFront(false);
        atticus.setPose('idle');
        atticus.setFace({ eyes: 'open', mouth: 'smile' });
        baby.setPose('idle');
      }
      AT.audio.sfx('yawn');
      baby.setFace({ eyes: 'sleepy', mouth: 'o' });
      AT.sayNow('c_b5');
      await E.wait(1.4);
      const big = E.node(c.fx, { sprite: 'blanket_big' }).set({ x: items.blanket.x, y: items.blanket.y, s: 0.45 });
      items.blanket.hide();
      AT.audio.sfx('swish');
      await big.to({ x: 720, y: 846, s: 0.85 }, 0.8, 'inOut');
      baby.setPose('sleep');
      baby.setFace({ eyes: 'closed', mouth: 'smile' });
      await E.wait(1.2);
      AT.audio.music('lullaby');
      const night = document.getElementById('night');
      const nt = { v: 0 };
      E.tween(nt, { v: 1 }, 2, 'inOut', () => { night.style.opacity = nt.v; });
      c.moon.to({ alpha: 1 }, 2);
      let noteT = 0;
      const sing = E.every((dt) => {
        atticus.talk(0.2);
        noteT -= dt;
        if (noteT <= 0) { noteT = 0.6; E.floatUp(c.fx, 'note', atticus.x + 40 + E.rand() * 60, atticus.y - 380, { scale: 0.7, rise: 260, life: 2.4 }); }
      });
      atticus.setFace({ eyes: 'happy', mouth: 'o' });
      await E.wait(1.5);
      await AT.say('c_b6');
      sing();
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
      await AT.celebrate(['m_brother'], { quiet: true });
      await E.wait(1.2);
    },
  },
};

// Recording harness (used by tools/render-videos.mjs)
AT.recordCartoon = async (name) => {
  const E = AT.engine;
  const cartoon = AT.cartoons[name];
  document.body.dataset.scene = 'cartoon';
  const loading = document.getElementById('loading');
  if (loading) loading.remove();
  const ctx = cartoon.build();
  await AT.imagesReady(E.stage, 15000);
  E.fade.style.opacity = 0;
  const rec = {
    ready: true, done: false, duration: 0,
    step: (dt) => E.step(dt),
    async renderAudio() { return AT.audio.renderOffline(AT.audio.rec.events, rec.duration || E.time); },
    events: AT.audio.rec.events,
  };
  window.__rec = rec;
  E.spawn(async () => {
    await cartoon.run(ctx);
    rec.duration = E.time;
    rec.done = true;
  });
};
