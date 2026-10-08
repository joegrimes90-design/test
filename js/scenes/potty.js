/* Potty time! Atticus plays until he gets the wiggly feeling. The player
 * spots it, sends him to the potty, and helps with every step:
 * pants down, sit, wee/poo, wipe, pants up, flush, wash hands. */
AT.scenes.potty = {
  CAM_PLAY: 0,
  CAM_BATH: 1400,

  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_playroom' });
    E.node(W, { sprite: 'bg_bathroom' });

    // bathroom things
    const tp = E.node(W, { sprite: 'tp_holder' }).set({ x: 2085, y: 560, s: 0.9 });
    const strip = E.node(W, { sprite: 'tp_strip' }).set({ x: 2085, y: 584, s: 0.9, sy: 0 });
    const towel = E.node(W, { sprite: 'towel' }).set({ x: 2850, y: 432, s: 0.9 });
    const sink = E.node(W, { sprite: 'sink' }).set({ x: 2560, y: 862, s: 0.95 });
    const stool = E.node(W, { sprite: 'stool' }).set({ x: 2560, y: 874, s: 0.85 });
    const potty = E.node(W, { sprite: 'potty' }).set({ x: 1900, y: 862 });
    potty.hit(240, 170, 0, -80, false);
    const flushBtn = E.node(W).set({ x: 2001, y: 756 });
    flushBtn.hit(110, 110, 0, 0);
    const swirl = E.node(W, { sprite: 'swirl' }).set({ x: 1900, y: 773, alpha: 0 });

    // toys
    const toys = {
      a: E.node(W, { sprite: 'block_a' }).set({ x: 360, y: 845, s: 0.9 }),
      b: E.node(W, { sprite: 'block_b' }).set({ x: 470, y: 845, s: 0.9 }),
      c: E.node(W, { sprite: 'block_c' }).set({ x: 415, y: 755, s: 0.9 }),
      ball: E.node(W, { sprite: 'ball' }).set({ x: 870, y: 795, s: 0.75 }),
      train: E.node(W, { sprite: 'train' }).set({ x: 1120, y: 852, s: 0.6 }),
      teddy: E.node(W, { sprite: 'teddy' }).set({ x: 1300, y: 848, s: 0.72 }),
    };
    const glow = E.node(W, { sprite: 'glow' }).set({ x: 640, y: 720, s: 1.4, alpha: 0 });
    const atticus = AT.puppet(W, 'atticus', { x: 660, y: 862 });
    const wiggle = E.node(atticus.bob, { sprite: 'wiggle' }).set({ x: 0, y: -150, alpha: 0 });
    const fx = E.layer(W);
    AT.cast = { A: atticus };
    const stars = AT.starBar(3);
    return { tp, strip, towel, sink, stool, potty, flushBtn, swirl, toys, glow, atticus, wiggle, fx, stars };
  },

  async run(c) {
    const E = AT.engine;
    const S = AT.scenes.potty;
    const { atticus } = c;
    AT.audio.music('play');
    this.toyFun(c);
    await AT.say('n_potty_intro');
    await AT.say('n_play_tap');
    const rounds = ['wee', 'poo', 'wee'];
    const cheers = [['m_hooray', 'd_potty'], ['d_high_five', 'm_big_boy'], ['m_superstar', 'd_woohoo']];
    for (let i = 0; i < rounds.length; i++) {
      await this.playTime(c, i === 0 ? 4 : 5 + E.rand() * 2);
      await this.feeling(c, rounds[i]);
      await this.useThePotty(c, rounds[i]);
      await this.washHands(c);
      // reward
      const sl = c.stars[i];
      const st = await AT.flyStar({ x: atticus.x - E.camera.x, y: atticus.y - 330 }, sl, 0.9);
      st.remove();
      sl.node.swap('star');
      atticus.setPose('dance');
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await AT.say('n_round_star');
      await AT.celebrate(cheers[i]);
      atticus.setPose('idle');
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
      if (i < rounds.length - 1) {
        AT.sayNow('n_again');
        atticus.setPose('run');
        await Promise.all([atticus.to({ x: 660, y: 862 }, 2.2, 'inOut'), E.tween(E.camera, { x: S.CAM_PLAY }, 2.2, 'inOut')]);
        atticus.setPose('idle');
        await E.wait(1.5);
      }
    }
    atticus.setPose('cheer');
    AT.confetti(60);
    AT.audio.sfx('fanfare');
    await AT.say('n_potty_done');
    AT.progress.potty = true;
    AT.save();
    AT.go('hub', { newSticker: 'potty' });
  },

  // tapping toys makes them do things
  toyFun(c) {
    const E = AT.engine;
    const { toys, atticus } = c;
    let tumbling = false;
    const react = () => {
      if (c.feelingNow) return;
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      E.spawn(async () => { await E.wait(0.9); if (!c.feelingNow) atticus.setFace({ eyes: 'open', mouth: 'smile' }); });
    };
    const blocks = [toys.a, toys.b, toys.c];
    const home = blocks.map((b) => ({ x: b.x, y: b.y }));
    blocks.forEach((b) => E.onTap(b, async () => {
      if (tumbling) return;
      tumbling = true;
      AT.audio.sfx('tumble');
      react();
      await Promise.all([
        toys.c.to({ x: home[2].x + 40, y: home[2].y + 100, rot: 80 }, 0.45, 'bounce'),
        toys.a.to({ rot: -20, x: home[0].x - 30 }, 0.3, 'out'),
        toys.b.to({ rot: 15, x: home[1].x + 30 }, 0.3, 'out'),
      ]);
      await E.wait(0.7);
      for (let i = 0; i < 3; i++) {
        AT.audio.sfx('block');
        await blocks[i].to({ x: home[i].x, y: home[i].y, rot: 0 }, 0.25, 'back');
      }
      tumbling = false;
    }, { pad: 1.1 }));
    let ballBusy = false;
    E.onTap(toys.ball, async () => {
      if (ballBusy) return;
      ballBusy = true;
      AT.audio.sfx('boing');
      react();
      await toys.ball.to({ y: 600, rot: 180 }, 0.35, 'out');
      await toys.ball.to({ y: 795, rot: 360 }, 0.7, 'bounce');
      toys.ball.set({ rot: 0 });
      ballBusy = false;
    });
    let trainBusy = false;
    E.onTap(toys.train, async () => {
      if (trainBusy) return;
      trainBusy = true;
      AT.audio.sfx('toot');
      react();
      await toys.train.to({ x: 1210 }, 0.8, 'inOut');
      await toys.train.to({ x: 1120 }, 0.8, 'inOut');
      trainBusy = false;
    });
    E.onTap(toys.teddy, async () => {
      AT.audio.sfx('squeak');
      react();
      await toys.teddy.to({ sy: 0.82, sx: 1.12 }, 0.1, 'out');
      await toys.teddy.to({ sy: 1, sx: 1 }, 0.5, 'elastic');
    });
  },

  async playTime(c, sec) {
    const E = AT.engine;
    const { atticus } = c;
    atticus.setPose('idle');
    const end = E.time + sec;
    while (E.time < end) {
      await E.wait(1.4 + E.rand());
      const r = E.rand();
      if (r < 0.35) { atticus.setFace({ eyes: 'happy', mouth: 'grin' }); await atticus.jump(40, 0.4); }
      else if (r < 0.7) { atticus.extra.head = -10; await E.wait(0.6); atticus.extra.head = 0; }
      else { atticus.setPose('wave'); await E.wait(0.8); atticus.setPose('idle'); }
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
    }
  },

  // the wiggly feeling, and choosing the potty
  async feeling(c, kind) {
    const E = AT.engine;
    const { atticus, wiggle, glow } = c;
    c.feelingNow = true;
    atticus.setPose('idle');
    atticus.setFace({ eyes: 'wide', mouth: 'o' });
    AT.audio.sfx('boing');
    await E.wait(0.6);
    atticus.setPose('wiggle');
    atticus.setFace({ eyes: 'worry', mouth: 'wobble' });
    glow.set({ x: atticus.x, y: atticus.y - 140 });
    const stopFx = E.every((dt, t) => {
      wiggle.set({ alpha: 0.6 + 0.4 * Math.sin(t * 10), s: 1 + 0.08 * Math.sin(t * 7) });
      glow.set({ x: atticus.x, alpha: 0.55 + 0.35 * Math.sin(t * 5), s: 1.3 + 0.15 * Math.sin(t * 5) });
    });
    let sfxT = 0;
    const stopSfx = E.every((dt) => { sfxT -= dt; if (sfxT <= 0) { AT.audio.sfx(kind === 'poo' ? 'rumble' : 'wiggle'); sfxT = 3; } });
    await AT.say(kind === 'poo' ? 'n_feeling_poo' : 'n_feeling_wee');
    await AT.say(kind === 'poo' ? 'a_need_poo' : 'a_need_wee', atticus);
    await AT.say('n_where');

    // choice bubbles: the potty, or keep playing
    const mk = (x, flip, icons) => {
      const n = E.node(E.ui).set({ x, y: 300, s: 0 });
      E.node(n, { sprite: 'thought' }).set({ sx: flip ? -1 : 1 });
      icons.forEach(([sp, ix, iy, is]) => E.node(n, { sprite: sp }).set({ x: ix, y: iy, s: is }));
      n.hit(270, 220, 10, -20);
      return n;
    };
    const pottyBub = mk(430, false, [['potty', 2, 36, 0.6]]);
    const toyBub = mk(890, true, [['teddy', -40, 30, 0.5], ['ball', 50, 0, 0.45]]);
    await Promise.all([pottyBub.to({ s: 1 }, 0.4, 'back'), toyBub.to({ s: 1 }, 0.4, 'back')]);
    let tries = 0;
    for (;;) {
      const pick = await E.choose([pottyBub, toyBub], { remind: 'n_where', hint: 0 });
      if (pick === 0) break;
      tries++;
      AT.audio.sfx('wrong');
      await toyBub.to({ s: 0 }, 0.3, 'in');
      toyBub.hide();
      await AT.say('n_not_toys');
      // only the potty is left now
      const p = await E.choose([pottyBub], { remind: 'n_where', hint: 0, hintNow: true });
      if (p === 0) break;
    }
    // reward for listening to your body
    AT.audio.sfx('sparkle');
    E.burst(E.ui, ['star', 'sparkle', 'heart'], pottyBub.x, pottyBub.y, { n: 18, speed: 450, scale: 0.55, life: 1 });
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    toyBub.to({ s: 0 }, 0.25, 'in');
    await pottyBub.to({ s: 1.25 }, 0.2, 'out');
    await pottyBub.to({ s: 0 }, 0.3, 'in');
    pottyBub.remove(); toyBub.remove();
    await AT.say('n_yes_potty');
    stopFx(); stopSfx();
    glow.set({ alpha: 0 });
    c.feelingNow = false;
  },

  async useThePotty(c, kind) {
    const E = AT.engine;
    const S = AT.scenes.potty;
    const { atticus, potty, tp, strip, flushBtn, swirl, fx, wiggle } = c;
    AT.sayNow('n_hurry');
    atticus.setPose('run');
    atticus.setFace({ eyes: 'worry', mouth: 'wobble' });
    await Promise.all([atticus.to({ x: 1900 }, 2.2, 'inOut'), E.tween(E.camera, { x: S.CAM_BATH }, 2.2, 'inOut')]);
    atticus.setPose('wiggle');
    await E.wait(0.4);

    // pants down
    atticus.setPose('tummy');
    atticus.hit(180, 130, 0, -82, false);
    await AT.say('n_pants_down');
    await E.waitTap(atticus, { remind: 'n_pants_down' });
    AT.audio.sfx('fwip');
    await E.tween(atticus.parts.shorts, { y: -40 }, 0.22, 'in');
    atticus.parts.shorts.set({ y: -80 });
    atticus.pantsDown = true;
    await E.wait(0.4);

    // sit
    await AT.say('n_sit');
    await E.waitTap(potty, { remind: 'n_sit' });
    AT.audio.sfx('boing');
    E.spawn(async () => { await E.wait(0.2); atticus.setPose('sit'); atticus.pantsDown = false; });
    await atticus.jump(55, 0.42);
    wiggle.set({ alpha: 0 });
    atticus.setFace({ eyes: 'open', mouth: 'smile' });
    await E.wait(0.3);

    // wee or poo
    atticus.hit(230, 320, 0, -170, false);
    await AT.say(kind === 'poo' ? 'n_do_poo' : 'n_do_wee');
    await E.waitTap(atticus, { remind: kind === 'poo' ? 'n_do_poo' : 'n_do_wee' });
    if (kind === 'poo') {
      atticus.setPose('push');
      atticus.setFace({ eyes: 'squeeze', mouth: 'puff' });
      AT.audio.sfx('rumble');
      await E.wait(1.4);
      AT.audio.sfx('plop');
      atticus.setPose('sit');
      atticus.setFace({ eyes: 'wide', mouth: 'o' });
      const plop = AT.text(fx, 'PLOP!', 'plop', 2080, 640);
      plop.set({ s: 0, rot: -8 });
      await plop.to({ s: 1 }, 0.35, 'back');
      await E.wait(0.7);
      plop.to({ alpha: 0, y: 600 }, 0.5).then(() => plop.remove());
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await AT.say('n_poo_done');
      await AT.say('a_did_poo', atticus);
    } else {
      atticus.setFace({ eyes: 'happy', mouth: 'smile' });
      AT.audio.sfx('tinkle');
      const stop = E.every((dt) => {
        if (Math.random() < dt * 14) E.floatUp(fx, Math.random() < 0.5 ? 'sparkle' : 'bubble', 1830 + Math.random() * 140, 770, { scale: 0.35 + Math.random() * 0.3, rise: 160, life: 1.2 });
      });
      await E.wait(1.8);
      stop();
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await AT.say('n_wee_done');
      await AT.say('a_did_wee', atticus);
    }
    atticus.setFace({ eyes: 'open', mouth: 'smile' });

    // wipe
    await AT.say('n_wipe');
    await E.waitTap(tp, { remind: 'n_wipe', pad: 1.3 });
    AT.audio.sfx('paper');
    await strip.to({ sy: 1 }, 0.6, 'out');
    AT.audio.sfx('fwip');
    await strip.to({ x: atticus.x + 80, y: atticus.y - 140, s: 0.3, alpha: 0 }, 0.45, 'in');
    strip.set({ x: 2085, y: 584, s: 0.9, sy: 0, alpha: 1 });
    for (let i = 0; i < 2; i++) {
      await E.tween(atticus.extra, { armR: 40 }, 0.2);
      await E.tween(atticus.extra, { armR: 0 }, 0.2);
    }
    // pants up
    atticus.hit(230, 320, 0, -170, false);
    await AT.say('n_pants_up');
    await E.waitTap(atticus, { remind: 'n_pants_up' });
    AT.audio.sfx('fwip', { up: true });
    atticus.setPose('idle');
    atticus.pantsDown = false;
    await atticus.jump(40, 0.35);
    await atticus.walkTo(1735, 260);

    // flush
    await AT.say('n_flush');
    await E.waitTap(flushBtn, { remind: 'n_flush' });
    AT.audio.sfx('flush');
    swirl.set({ alpha: 1, s: 1, rot: 0 });
    potty.to({ rot: 1.5 }, 0.1).then(() => potty.to({ rot: 0 }, 0.4, 'elastic'));
    const t0 = E.time;
    const stopSwirl = E.every(() => {
      const k = (E.time - t0) / 2;
      swirl.set({ sx: Math.cos((E.time - t0) * 14) * (1 - k * 0.6), alpha: k < 0.8 ? 1 : Math.max(0, (1 - k) * 5) });
      if (Math.random() < 0.3) E.floatUp(fx, 'bubble', 1860 + Math.random() * 80, 770, { scale: 0.3, rise: 120, life: 0.8 });
    });
    atticus.setPose('wave');
    await AT.say(kind === 'poo' ? 'n_flush_bye_poo' : 'n_flush_bye_wee');
    await E.wait(Math.max(0, 2.1 - (E.time - t0)));
    stopSwirl();
    swirl.set({ alpha: 0 });
    atticus.setPose('idle');
  },

  async washHands(c) {
    const E = AT.engine;
    const { atticus, towel } = c;
    await AT.say('n_wash');
    await atticus.walkTo(2560, 300);
    AT.audio.sfx('boing');
    E.spawn(() => atticus.jump(50, 0.35));
    await atticus.to({ y: 820 }, 0.35, 'out');

    // close-up of the sink
    const card = AT.card(800, 430, 330, 'tiles');
    const I = card.inner;
    E.node(I, { sprite: 'sink' }).set({ x: 760, y: 1280, s: 2.6 });
    const hands = E.node(I, { sprite: 'hands' }).set({ x: 880, y: 655, s: 1.05 });
    const water = E.node(I, { sprite: 'water' }).set({ x: 890, y: 422, s: 2.4, sy: 0 });
    const soap = E.node(I, { sprite: 'soap' }).set({ x: 1040, y: 515, s: 1.6 });
    const tap = E.node(I).set({ x: 790, y: 410 });
    tap.hit(220, 130, 0, 0, false);
    hands.hit(300, 300, 0, -20, false);
    soap.hit(170, 230, 0, -60, false);
    await card.show();

    await AT.say('n_tap_on');
    await E.waitTap(tap, { remind: 'n_tap_on' });
    let waterOn = true;
    water.to({ sy: 1 }, 0.3, 'out');
    let wt = 0;
    const stopWater = E.every((dt) => { if (!waterOn) return; wt -= dt; if (wt <= 0) { AT.audio.sfx('water', { dur: 1.6 }); wt = 1.3; } });

    await AT.say('n_soap');
    await E.waitTap(soap, { remind: 'n_soap' });
    AT.audio.sfx('squish');
    soap.to({ sy: 0.85 }, 0.1).then(() => soap.to({ sy: 1 }, 0.4, 'elastic'));
    const blobs = [];
    for (let i = 0; i < 3; i++) blobs.push(E.node(I, { sprite: 'foam' }).set({ x: 860 + i * 25, y: 590 + (i % 2) * 20, s: 0 }));
    await Promise.all(blobs.map((b) => b.to({ s: 1 }, 0.3, 'back')));

    // scrub!
    await AT.say('n_scrub');
    let scrubbed = 0;
    let sndT = 0;
    let shake = 0;
    const off = E.onRub(hands, (d, p) => {
      scrubbed += d;
      shake = 0.25;
      if (E.time > sndT) { AT.audio.sfx(Math.random() < 0.5 ? 'scrub' : 'pop'); sndT = E.time + 0.12; }
      if (Math.random() < 0.35) {
        const b = E.node(I, { sprite: Math.random() < 0.6 ? 'bubble' : 'foam' }).set({ x: p.x, y: p.y, s: 0.3 + Math.random() * 0.6 });
        blobs.push(b);
        b.to({ y: p.y - 30 - Math.random() * 60, x: p.x + (Math.random() - 0.5) * 80 }, 0.8, 'out');
      }
    });
    const tapScrub = E.onTap(hands, () => { scrubbed += 140; shake = 0.3; AT.audio.sfx('pop'); });
    const stopShake = E.every((dt, t) => {
      shake = Math.max(0, shake - dt);
      hands.set({ rot: shake > 0 ? Math.sin(t * 30) * 6 : 0, x: 880 + (shake > 0 ? Math.sin(t * 25) * 10 : 0) });
    });
    let hand = null;
    let idle = E.time;
    while (scrubbed < 2600) {
      await E.wait(0.2);
      if (E.time - Math.max(idle, E.lastInput) > 6 && !hand) { hand = E.pointAt(hands); AT.sayNow('n_scrub'); idle = E.time; }
      if (hand && E.time - E.lastInput < 0.3) { hand.remove(); hand = null; }
    }
    if (hand) hand.remove();
    off(); tapScrub(); stopShake();
    hands.set({ rot: 0, x: 880 });
    AT.audio.sfx('sparkle');

    await AT.say('n_rinse');
    await E.waitTap(tap, { remind: 'n_rinse' });
    AT.audio.sfx('swish');
    blobs.forEach((b, i) => b.to({ y: b.y + 200, alpha: 0 }, 0.6 + (i % 5) * 0.1, 'in').then(() => b.remove()));
    await E.wait(1.2);
    waterOn = false;
    stopWater();
    await water.to({ sy: 0 }, 0.25, 'in');
    await card.hide();

    // dry
    AT.audio.sfx('boing');
    E.spawn(() => atticus.jump(40, 0.3));
    await atticus.to({ y: 862 }, 0.3, 'in');
    await AT.say('n_dry');
    await E.waitTap(towel, { remind: 'n_dry', pad: 1.2 });
    await atticus.walkTo(2790, 300);
    AT.audio.sfx('swish');
    const tt = E.time;
    await E.until(() => { towel.set({ rot: Math.sin((E.time - tt) * 18) * 6 }); return E.time - tt > 1; });
    towel.set({ rot: 0 });
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    await AT.say('a_clean', atticus);
    await atticus.walkTo(2300, 320);
  },
};
