/* Baby sister: work out what she needs (teddy, bottle, a burp, peekaboo,
 * gentle strokes, a blanket) and sing her to sleep. */
AT.scenes.baby = {
  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_nursery' });
    const moon = E.node(W, { sprite: 'moon' }).set({ x: 1170, y: 210, s: 0.8, alpha: 0 });
    E.node(W, { sprite: 'cot' }).set({ x: 240, y: 712, s: 0.75 });
    const mobile = E.node(W, { sprite: 'mobile' }).set({ x: 240, y: 20, s: 0.7 });
    E.every((dt, t) => mobile.set({ rot: Math.sin(t * 0.7) * 4 }));
    E.node(W, { sprite: 'playmat' }).set({ x: 720, y: 830 });
    const baby = AT.puppet(W, 'baby', { x: 720, y: 830, s: 1.15 });
    const atticus = AT.puppet(W, 'atticus', { x: 1085, y: 862, s: 0.95 });
    atticus.hit(220, 440, 0, -220, false);
    E.node(W, { sprite: 'shelf_panel' }).set({ x: 1465, y: 480 });
    const items = {
      teddy: E.node(W, { sprite: 'teddy' }).set({ x: 1465, y: 288, s: 0.62 }),
      bottle: E.node(W, { sprite: 'bottle' }).set({ x: 1465, y: 468, s: 0.82 }),
      blanket: E.node(W, { sprite: 'blanket' }).set({ x: 1465, y: 640, s: 0.66 }),
      rattle: E.node(W, { sprite: 'rattle' }).set({ x: 1465, y: 830, s: 0.85 }),
    };
    for (const k in items) { items[k].home = { x: items[k].x, y: items[k].y, s: items[k].s }; items[k].key = k; }
    const bubble = E.node(W).set({ x: 905, y: 375, s: 0 });
    E.node(bubble, { sprite: 'thought' }).set({ s: 0.8 });
    bubble.icon = null;
    const fx = E.layer(W);
    AT.cast = { A: atticus };
    return { baby, atticus, items, bubble, moon, fx };
  },

  async run(c) {
    const E = AT.engine;
    const { baby, atticus, items } = c;
    AT.audio.music('play');
    baby.setFace({ eyes: 'happy', mouth: 'giggle' });
    baby.setPose('happy');
    await AT.say('n_baby_intro');
    atticus.setPose('wave');
    await AT.say('a_hello_baby', atticus);
    atticus.setPose('idle');
    AT.audio.sfx('giggle');
    await E.wait(0.8);

    // 1. sad -> teddy
    baby.setPose('cry');
    baby.setFace({ eyes: 'cry', mouth: 'cry', tears: 'on' });
    const stopCry = this.loopSfx('cry', 2.6);
    await this.think(c, 'teddy', 0.5);
    await AT.say('n_baby_sad');
    await this.pickItem(c, 'teddy', 'n_baby_sad');
    stopCry();
    this.hideThought(c);
    await items.teddy.to({ x: 800, y: 845, s: 0.55, rot: -8 }, 0.7, 'inOut');
    baby.setPose('happy');
    baby.setFace({ eyes: 'happy', mouth: 'giggle', tears: null });
    AT.audio.sfx('giggle');
    this.hearts(c, 6);
    await AT.say('n_teddy_yes');
    await items.teddy.to({ x: 560, y: 850, rot: 0 }, 0.5, 'inOut');
    baby.setPose('idle');
    baby.setFace({ eyes: 'open', mouth: 'smile' });
    await E.wait(0.6);

    // 2. hungry -> bottle, then a burp
    baby.setFace({ eyes: 'open', mouth: 'o' });
    AT.audio.sfx('rumble');
    await this.think(c, 'bottle', 0.6);
    await AT.say('n_baby_hungry');
    await this.pickItem(c, 'bottle', 'n_baby_hungry');
    this.hideThought(c);
    await items.bottle.to({ x: 794, y: 557, s: 0.7, rot: -135 }, 0.7, 'inOut');
    baby.setPose('eat');
    baby.setFace({ eyes: 'happy', mouth: 'o' });
    AT.audio.sfx('gulp');
    const t0 = E.time;
    const stopTilt = E.every(() => items.bottle.set({ rot: -135 + Math.sin((E.time - t0) * 5) * 4 }));
    await AT.say('n_bottle_yes');
    await E.wait(0.6);
    stopTilt();
    await items.bottle.to({ x: 1465, y: 1100, alpha: 0 }, 0.6, 'in');
    items.bottle.hide();
    baby.setPose('idle');
    baby.setFace({ eyes: 'open', mouth: 'smile' });
    baby.hit(260, 330, 0, -150, false);
    await AT.say('n_burp');
    await E.waitTap(baby, { remind: 'n_burp' });
    AT.audio.sfx('clap');
    await baby.jump(14, 0.2);
    AT.audio.sfx('clap');
    await baby.jump(14, 0.2);
    AT.audio.sfx('burp');
    baby.setFace({ eyes: 'open', mouth: 'o' });
    await E.wait(0.6);
    baby.setFace({ eyes: 'happy', mouth: 'giggle' });
    baby.setPose('happy');
    AT.audio.sfx('giggle');
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    await AT.say('n_burp_done');
    baby.setPose('idle');
    atticus.setFace({ eyes: 'open', mouth: 'smile' });

    // 3. peekaboo
    baby.setFace({ eyes: 'open', mouth: 'pout' });
    await AT.say('n_baby_play');
    for (let i = 0; i < 3; i++) {
      if (i > 0) AT.sayNow('n_peek_again');
      await E.waitTap(atticus, { remind: i ? 'n_peek_again' : 'n_baby_play' });
      atticus.armsFront(true);
      atticus.setPose('peek');
      baby.setFace({ eyes: 'open', mouth: 'o' });
      if (i === 0) AT.sayNow('a_peekaboo', atticus);
      await E.wait(0.85);
      atticus.setPose('cheer');
      atticus.setFace({ eyes: 'wide', mouth: 'grin' });
      AT.audio.sfx('peek');
      await E.wait(0.15);
      baby.setFace({ eyes: 'happy', mouth: 'giggle' });
      baby.setPose('happy');
      AT.audio.sfx('giggle');
      this.hearts(c, 3);
      await E.wait(1.1);
      atticus.armsFront(false);
      atticus.setPose('idle');
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
      baby.setPose('idle');
    }
    await AT.say('n_baby_giggle');

    // 4. gentle strokes
    baby.setFace({ eyes: 'open', mouth: 'smile' });
    baby.hit(190, 170, 0, -215, true);
    await AT.say('n_gentle');
    let stroked = 0;
    let nextHeart = 0;
    const offRub = E.onRub(baby, (d) => {
      stroked += d;
      baby.setFace({ eyes: 'happy' });
      if (stroked > nextHeart) {
        nextHeart = stroked + 140;
        E.floatUp(c.fx, 'heart', 720 + (Math.random() - 0.5) * 120, 520, { scale: 0.45, rise: 200 });
        if (Math.random() < 0.4) AT.audio.sfx('coo');
      }
    });
    const offTap = E.onTap(baby, () => { stroked += 220; E.floatUp(c.fx, 'heart', 720, 520, { scale: 0.45 }); AT.audio.sfx('coo'); });
    let hand = null;
    let idleFrom = E.time;
    while (stroked < 1500) {
      await E.wait(0.2);
      if (!hand && E.time - Math.max(idleFrom, E.lastInput) > 6) {
        hand = E.node(c.fx, { sprite: 'hand' });
        const h0 = E.time;
        hand.stop = E.every(() => hand.set({ x: 720 + Math.sin((E.time - h0) * 3) * 70, y: 600 }));
        AT.sayNow('n_gentle');
        idleFrom = E.time;
      }
      if (hand && E.time - E.lastInput < 0.3) { hand.stop(); hand.remove(); hand = null; idleFrom = E.time; }
    }
    if (hand) { hand.stop(); hand.remove(); }
    offRub(); offTap();
    AT.audio.sfx('coo');
    this.hearts(c, 5);
    await AT.say('n_gentle_yes');

    // 5. sleepy -> blanket, lullaby
    AT.audio.sfx('yawn');
    baby.setFace({ eyes: 'sleepy', mouth: 'o' });
    await E.wait(1);
    baby.setFace({ eyes: 'sleepy', mouth: 'smile' });
    await this.think(c, 'blanket', 0.5);
    await AT.say('n_baby_sleepy');
    await this.pickItem(c, 'blanket', 'n_baby_sleepy');
    this.hideThought(c);
    const big = E.node(c.fx, { sprite: 'blanket_big' }).set({ x: items.blanket.x, y: items.blanket.y, s: 0.45 });
    items.blanket.hide();
    AT.audio.sfx('swish');
    await big.to({ x: 720, y: 846, s: 0.85 }, 0.8, 'inOut');
    baby.setPose('sleep');
    baby.setFace({ eyes: 'closed', mouth: 'smile' });
    await AT.say('n_blanket_yes');
    // lights down
    AT.audio.music('lullaby');
    const night = document.getElementById('night');
    const nt = { v: 0 };
    E.tween(nt, { v: 1 }, 2, 'inOut', () => { night.style.opacity = nt.v; });
    c.moon.to({ alpha: 1 }, 2);
    await AT.say('n_lullaby');
    atticus.setFace({ eyes: 'happy', mouth: 'o' });
    const sing = E.time;
    let noteT = 0, zT = 0;
    const stopSing = E.every((dt) => {
      atticus.talk(0.2);
      atticus.extra.head = Math.sin((E.time - sing) * 2) * 6;
      noteT -= dt; zT -= dt;
      if (noteT <= 0) { noteT = 0.6; E.floatUp(c.fx, 'note', atticus.x + 40 + Math.random() * 60, atticus.y - 380, { scale: 0.7, rise: 260, life: 2.4 }); }
      if (zT <= 0) {
        zT = 1.6;
        const z = AT.text(c.fx, 'z', 'zzz', 790, 520);
        const z0 = E.time;
        const st = E.every(() => { const k = (E.time - z0) / 2.4; if (k > 1) { st(); z.remove(); return; } z.set({ x: 790 + k * 80, y: 520 - k * 160, s: 0.6 + k * 0.6, alpha: k > 0.7 ? (1 - k) / 0.3 : 1 }); });
      }
    });
    await E.wait(6);
    stopSing();
    atticus.extra.head = 0;
    atticus.setFace({ eyes: 'open', mouth: 'smile' });
    await AT.say('n_asleep');
    await AT.celebrate(['m_shh', 'd_brother'], { quiet: true });
    AT.progress.baby = true;
    AT.save();
    AT.go('hub', { newSticker: 'baby' });
  },

  loopSfx(name, every) {
    const E = AT.engine;
    let t = 0;
    return E.every((dt) => { t -= dt; if (t <= 0) { AT.audio.sfx(name); t = every; } });
  },
  hearts(c, n) {
    const E = AT.engine;
    for (let i = 0; i < n; i++) {
      E.spawn(async () => { await E.wait(i * 0.15); E.floatUp(c.fx, 'heart', 720 + (Math.random() - 0.5) * 220, 560, { scale: 0.4 + Math.random() * 0.3, rise: 240 }); });
    }
  },
  async think(c, sprite, s) {
    const b = c.bubble;
    if (b.icon) b.icon.remove();
    b.icon = AT.engine.node(b, { sprite }).set({ x: 8, y: -24, s });
    AT.audio.sfx('pop');
    await b.to({ s: 1 }, 0.4, 'back');
  },
  hideThought(c) { c.bubble.to({ s: 0 }, 0.25, 'in'); },

  // choose from the shelf until the right thing is picked
  async pickItem(c, want, remind) {
    const E = AT.engine;
    const { items, baby } = c;
    const avail = Object.values(items).filter((it) => it.visible && !it.used);
    let wrong = 0;
    for (;;) {
      const i = await E.choose(avail, { remind, hint: avail.findIndex((it) => it.key === want), hintAfter: wrong ? 3 : 7, pad: 1.1 });
      const it = avail[i];
      if (it.key === want) {
        it.used = true;
        AT.audio.sfx('sparkle');
        E.burst(c.fx, ['sparkle', 'star'], it.x, it.y - 60, { n: 10, speed: 300, gravity: 200, scale: 0.45, life: 0.8 });
        return it;
      }
      wrong++;
      AT.audio.sfx('wrong');
      const h = E.time;
      E.spawn(() => E.until(() => { it.set({ rot: Math.sin((E.time - h) * 25) * 10 }); if (E.time - h > 0.5) { it.set({ rot: 0 }); return true; } return false; }));
      E.spawn(() => E.until(() => { baby.extra.head = Math.sin((E.time - h) * 14) * 10; if (E.time - h > 0.7) { baby.extra.head = 0; return true; } return false; }));
      c.bubble.to({ s: 1.12 }, 0.12).then(() => c.bubble.to({ s: 1 }, 0.3, 'elastic'));
      await AT.say('n_try_again');
    }
  },
};
